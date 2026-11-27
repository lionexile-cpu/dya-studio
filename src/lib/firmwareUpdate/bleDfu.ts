/**
 * Legacy Nordic (SDK 11) BLE DFU client, as implemented by the Adafruit nRF52
 * bootloader's OTA mode (lib/sdk11/.../dfu_transport_ble.c) and driven by
 * adafruit-nrfutil `dfu_transport_ble.py`.
 *
 *   Service        00001530-1212-efde-1523-785feabcd123
 *   Control point  00001531-...  write (with response) + notify
 *   Packet         00001532-...  write without response
 *
 * Sequence (application update):
 *   CP  <- [0x01, 0x04]                START_DFU, mode = application
 *   PKT <- u32 sd=0, u32 bl=0, u32 app  image sizes
 *   CP  -> [0x10, 0x01, status]        after the app region is erased
 *   CP  <- [0x02, 0x00]                INIT start
 *   PKT <- init packet (<= 20 B per write)
 *   CP  <- [0x02, 0x01]                INIT complete
 *   CP  -> [0x10, 0x02, status]
 *   CP  <- [0x08, n lo, n hi]          packet receipt notification every n packets
 *   CP  <- [0x03]                      RECEIVE_FIRMWARE_IMAGE
 *   PKT <- data (20 B, multiple of 4)  ... CP -> [0x11, u32 bytes] every n packets
 *   CP  -> [0x10, 0x03, status]        after the last packet is written to flash
 *   CP  <- [0x04]                      VALIDATE  -> [0x10, 0x04, status]
 *   CP  <- [0x05]                      ACTIVATE_AND_RESET (device reboots)
 *
 * NOTE: Chrome's Web Bluetooth GATT blocklist blocks the 0x1530 service
 * outright, so this driver can only run in an environment without that
 * blocklist. The protocol logic is kept transport-agnostic (see
 * {@link LegacyDfuLink}) and unit-tested with a mocked GATT.
 */
import {
  DfuError,
  throwIfAborted,
  type DfuImage,
  type DfuProgress,
  type DfuRunOptions,
  type DfuStage,
} from "./types";

export const LEGACY_DFU_SERVICE = "00001530-1212-efde-1523-785feabcd123";
export const LEGACY_DFU_CONTROL_POINT = "00001531-1212-efde-1523-785feabcd123";
export const LEGACY_DFU_PACKET = "00001532-1212-efde-1523-785feabcd123";

export const OP_START_DFU = 0x01;
export const OP_INIT_DFU = 0x02;
export const OP_RECEIVE_FIRMWARE = 0x03;
export const OP_VALIDATE = 0x04;
export const OP_ACTIVATE_AND_RESET = 0x05;
export const OP_SYSTEM_RESET = 0x06;
export const OP_PKT_RCPT_NOTIF_REQ = 0x08;
export const OP_RESPONSE = 0x10;
export const OP_PKT_RCPT_NOTIF = 0x11;

export const MODE_APPLICATION = 0x04;

export const RESPONSE_STATUS_TEXT: Record<number, string> = {
  1: "Success",
  2: "Invalid state",
  3: "Not supported",
  4: "Data size exceeds limit",
  5: "CRC error",
  6: "Operation failed",
};

/** Abstraction of the two GATT characteristics used by legacy DFU. */
export interface LegacyDfuLink {
  /** Write to the control point (write with response). */
  writeControl(data: Uint8Array): Promise<void>;
  /** Write to the packet characteristic (write without response). */
  writePacket(data: Uint8Array): Promise<void>;
  /** Register the control-point notification and disconnect handlers. */
  subscribe(handlers: {
    onNotification: (data: Uint8Array) => void;
    onDisconnect: () => void;
  }): Promise<void>;
  disconnect(): void;
}

export interface BleDfuOptions extends DfuRunOptions {
  /** Bytes per packet write. Must be a multiple of 4; 20 fits ATT MTU 23. */
  packetSize?: number;
  /** Packet receipt notification interval (packets). */
  prn?: number;
  /** Timeout for START (covers the flash erase). */
  startTimeoutMs?: number;
  /** Timeout for every other response / receipt notification. */
  responseTimeoutMs?: number;
  /** Retries for a packet write that the browser reports as failed. */
  writeRetries?: number;
}

class NotificationQueue {
  private items: Uint8Array[] = [];
  private waiter: {
    match: (d: Uint8Array) => boolean;
    resolve: (d: Uint8Array) => void;
    reject: (e: unknown) => void;
  } | null = null;
  private failure: DfuError | null = null;

  push(data: Uint8Array) {
    if (this.waiter && this.waiter.match(data)) {
      const w = this.waiter;
      this.waiter = null;
      w.resolve(data);
      return;
    }
    this.items.push(data);
  }

  fail(err: DfuError) {
    this.failure = err;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.reject(err);
    }
  }

  next(
    match: (d: Uint8Array) => boolean,
    timeoutMs: number,
    stage: DfuStage,
    what: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (this.failure) return Promise.reject(this.failure);
    const idx = this.items.findIndex(match);
    if (idx >= 0) {
      const [d] = this.items.splice(idx, 1);
      return Promise.resolve(d);
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const timer = setTimeout(() => {
        this.waiter = null;
        cleanup();
        reject(
          new DfuError("timeout", `Timed out waiting for ${what}.`, { stage }),
        );
      }, timeoutMs);
      const onAbort = () => {
        this.waiter = null;
        cleanup();
        reject(new DfuError("aborted", "The update was cancelled.", { stage }));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiter = {
        match,
        resolve: (d) => {
          cleanup();
          resolve(d);
        },
        reject: (e) => {
          cleanup();
          reject(e);
        },
      };
    });
  }
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function isResponseTo(op: number) {
  return (d: Uint8Array) =>
    d.length >= 3 && d[0] === OP_RESPONSE && d[1] === op;
}

const isReceipt = (d: Uint8Array) =>
  d.length >= 5 && d[0] === OP_PKT_RCPT_NOTIF;

/**
 * Run a complete legacy DFU application update over an already connected
 * link. On failure or cancel the link is disconnected WITHOUT resetting the
 * device: the bootloader then re-advertises and stays in DFU mode, so the
 * update can simply be retried.
 */
export async function runLegacyBleDfu(
  link: LegacyDfuLink,
  image: DfuImage,
  opts: BleDfuOptions = {},
): Promise<void> {
  const packetSize = opts.packetSize ?? 20;
  const prn = opts.prn ?? 10;
  const startTimeout = opts.startTimeoutMs ?? 60_000;
  const responseTimeout = opts.responseTimeoutMs ?? 15_000;
  const writeRetries = opts.writeRetries ?? 3;
  const { signal, onProgress } = opts;
  const total = image.binary.length;

  if (packetSize % 4 !== 0 || packetSize <= 0) {
    throw new DfuError(
      "protocol",
      "Packet size must be a positive multiple of 4.",
    );
  }
  if (total % 4 !== 0) {
    throw new DfuError(
      "protocol",
      "Firmware size must be a multiple of 4 bytes.",
    );
  }

  const queue = new NotificationQueue();
  let stage: DfuStage = "starting";
  const report = (bytesSent: number) => {
    const p: DfuProgress = { stage, bytesSent, totalBytes: total };
    onProgress?.(p);
  };

  await link.subscribe({
    onNotification: (d) => queue.push(d),
    onDisconnect: () =>
      queue.fail(
        new DfuError(
          "disconnected",
          "The keyboard disconnected during the update.",
          {
            stage,
          },
        ),
      ),
  });

  const expectSuccess = async (op: number, timeout: number, what: string) => {
    const resp = await queue.next(
      isResponseTo(op),
      timeout,
      stage,
      what,
      signal,
    );
    const status = resp[2];
    if (status !== 1) {
      throw new DfuError(
        "remote-error",
        `${what} failed: ${RESPONSE_STATUS_TEXT[status] ?? `status ${status}`}.`,
        { status, stage },
      );
    }
  };

  const control = async (bytes: number[]) => {
    throwIfAborted(signal, stage);
    try {
      await link.writeControl(Uint8Array.from(bytes));
    } catch (e) {
      throw new DfuError(
        "transport",
        `Control point write failed: ${String(e)}`,
        {
          stage,
          cause: e,
        },
      );
    }
  };

  const packet = async (bytes: Uint8Array) => {
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(signal, stage);
      try {
        await link.writePacket(bytes);
        return;
      } catch (e) {
        if (attempt >= writeRetries) {
          throw new DfuError("transport", `Packet write failed: ${String(e)}`, {
            stage,
            cause: e,
          });
        }
      }
    }
  };

  try {
    // 1. START: sizes, then wait for the erase to finish.
    report(0);
    await control([OP_START_DFU, MODE_APPLICATION]);
    const sizes = new Uint8Array(12);
    sizes.set(u32le(0), 0);
    sizes.set(u32le(0), 4);
    sizes.set(u32le(total), 8);
    await packet(sizes);
    stage = "erasing";
    report(0);
    await expectSuccess(OP_START_DFU, startTimeout, "START DFU");

    // 2. INIT packet.
    stage = "init";
    report(0);
    await control([OP_INIT_DFU, 0x00]);
    for (let i = 0; i < image.initPacket.length; i += 20) {
      await packet(image.initPacket.subarray(i, i + 20));
    }
    await control([OP_INIT_DFU, 0x01]);
    await expectSuccess(OP_INIT_DFU, responseTimeout, "INIT DFU");

    // 3. Packet receipt notifications.
    if (prn > 0) {
      await control([OP_PKT_RCPT_NOTIF_REQ, prn & 0xff, (prn >> 8) & 0xff]);
    }

    // 4. Firmware data.
    stage = "uploading";
    await control([OP_RECEIVE_FIRMWARE]);
    const packets = Math.ceil(total / packetSize);
    let sent = 0;
    for (let n = 1; n <= packets; n++) {
      const chunk = image.binary.subarray(sent, sent + packetSize);
      await packet(chunk);
      sent += chunk.length;
      if (prn > 0 && n % prn === 0 && n < packets) {
        const rcpt = await queue.next(
          isReceipt,
          responseTimeout,
          stage,
          "packet receipt notification",
          signal,
        );
        const received = new DataView(rcpt.buffer, rcpt.byteOffset).getUint32(
          1,
          true,
        );
        if (received !== sent) {
          throw new DfuError(
            "protocol",
            `The keyboard received ${received} bytes but ${sent} were sent (packets were lost).`,
            { stage },
          );
        }
        report(sent);
      }
    }
    report(sent);
    await expectSuccess(
      OP_RECEIVE_FIRMWARE,
      responseTimeout,
      "firmware upload",
    );

    // 5. VALIDATE (CRC check in the bootloader).
    stage = "validating";
    report(sent);
    await control([OP_VALIDATE]);
    await expectSuccess(OP_VALIDATE, responseTimeout, "VALIDATE");

    // 6. ACTIVATE: the bootloader writes its settings and resets, which may
    // drop the link before the write is acknowledged.
    stage = "activating";
    report(sent);
    try {
      await link.writeControl(Uint8Array.from([OP_ACTIVATE_AND_RESET]));
    } catch {
      /* the device resetting is the expected outcome */
    }
    stage = "done";
    report(sent);
  } catch (e) {
    link.disconnect();
    throw e;
  }
  link.disconnect();
}
