/**
 * Legacy Nordic (SDK 11) serial DFU over the HCI/SLIP transport, as
 * implemented by the Adafruit nRF52 bootloader's USB CDC interface and driven
 * by `adafruit-nrfutil dfu serial` (nordicsemi/dfu/dfu_transport_serial.py).
 *
 * Every frame is a reliable vendor-specific HCI packet:
 *
 *   0xC0 | SLIP-escaped( header[4] | payload | crc16 LE ) | 0xC0
 *   header[0] = seq | ack<<3 | data_integrity<<6 | reliable<<7  (ack = seq+1 mod 8)
 *   header[1] = type(14) | (len & 0xF) << 4
 *   header[2] = len >> 4
 *   header[3] = two's complement checksum of header[0..2]
 *
 * The bootloader answers each in-sequence packet with a 4-byte ACK frame whose
 * ack number is the next sequence number it expects. If its RX buffers are
 * full it silently drops the packet, so we retransmit on timeout (the
 * bootloader re-ACKs a duplicate without processing it again).
 *
 * Payloads (u32 LE packet id first):
 *   START  3, mode(4 = app), sd_size, bl_size, app_size
 *   INIT   1, init packet, 0x0000 padding
 *   DATA   4, <= 512 bytes
 *   STOP   5  -> bootloader validates, activates and resets
 *
 * Flash erase/write block the bootloader CPU, so like nrfutil we wait for the
 * erase after START and pause one page-write time every 8 data packets.
 */
import { crc16Ccitt } from "./crc";
import {
  abortableSleep,
  DfuError,
  throwIfAborted,
  type DfuImage,
  type DfuRunOptions,
  type DfuStage,
} from "./types";

export const HCI_PACKET_TYPE = 14;
export const DFU_INIT_PACKET = 1;
export const DFU_START_PACKET = 3;
export const DFU_DATA_PACKET = 4;
export const DFU_STOP_DATA_PACKET = 5;
export const DFU_UPDATE_MODE_APP = 4;

const SLIP_END = 0xc0;
const SLIP_ESC = 0xdb;
const SLIP_ESC_END = 0xdc;
const SLIP_ESC_ESC = 0xdd;

export function slipEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [SLIP_END];
  for (const b of data) {
    if (b === SLIP_END) out.push(SLIP_ESC, SLIP_ESC_END);
    else if (b === SLIP_ESC) out.push(SLIP_ESC, SLIP_ESC_ESC);
    else out.push(b);
  }
  out.push(SLIP_END);
  return Uint8Array.from(out);
}

/** Build one reliable HCI frame (already SLIP encoded). */
export function buildHciFrame(seq: number, payload: Uint8Array): Uint8Array {
  const len = payload.length;
  const h0 = (seq & 7) | (((seq + 1) % 8) << 3) | (1 << 6) | (1 << 7);
  const h1 = HCI_PACKET_TYPE | ((len & 0x0f) << 4);
  const h2 = (len & 0xff0) >> 4;
  const h3 = (~(h0 + h1 + h2) + 1) & 0xff;
  const body = new Uint8Array(4 + len + 2);
  body.set([h0, h1, h2, h3], 0);
  body.set(payload, 4);
  const crc = crc16Ccitt(body.subarray(0, 4 + len));
  body[4 + len] = crc & 0xff;
  body[4 + len + 1] = (crc >> 8) & 0xff;
  return slipEncode(body);
}

/** Incremental SLIP decoder: feed bytes, get complete (unescaped) frames. */
export class SlipDecoder {
  private buf: number[] = [];
  private inFrame = false;
  private escaped = false;

  push(chunk: Uint8Array): Uint8Array[] {
    const frames: Uint8Array[] = [];
    for (const b of chunk) {
      if (b === SLIP_END) {
        if (this.inFrame && this.buf.length > 0) {
          frames.push(Uint8Array.from(this.buf));
        }
        this.buf = [];
        this.inFrame = true;
        this.escaped = false;
        continue;
      }
      if (!this.inFrame) continue;
      if (this.escaped) {
        this.buf.push(
          b === SLIP_ESC_END ? SLIP_END : b === SLIP_ESC_ESC ? SLIP_ESC : b,
        );
        this.escaped = false;
      } else if (b === SLIP_ESC) {
        this.escaped = true;
      } else {
        this.buf.push(b);
      }
    }
    return frames;
  }
}

/** Byte stream abstraction over Web Serial (or a test double). */
export interface SerialDfuLink {
  write(data: Uint8Array): Promise<void>;
  /** Register a callback for received bytes and for the port going away. */
  subscribe(handlers: {
    onData: (d: Uint8Array) => void;
    onClose: () => void;
  }): void;
  close(): Promise<void>;
}

export interface SerialDfuOptions extends DfuRunOptions {
  /** Max data bytes per DATA packet (nrfutil: 512). */
  chunkSize?: number;
  ackTimeoutMs?: number;
  maxAttempts?: number;
  /** Per-page erase time used to wait after START (nrfutil: 89.7 ms). */
  pageEraseMs?: number;
  /** Page write time, paused every 8 data packets (nrfutil: 102.4 ms). */
  pageWriteMs?: number;
  /** Sleep implementation (tests make it instant). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
};

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function runSerialDfu(
  link: SerialDfuLink,
  image: DfuImage,
  opts: SerialDfuOptions = {},
): Promise<void> {
  const chunkSize = opts.chunkSize ?? 512;
  const ackTimeout = opts.ackTimeoutMs ?? 1000;
  const maxAttempts = opts.maxAttempts ?? 6;
  const pageEraseMs = opts.pageEraseMs ?? 89.7;
  const pageWriteMs = opts.pageWriteMs ?? 102.4;
  const sleep = opts.sleep ?? abortableSleep;
  const { signal, onProgress } = opts;
  const total = image.binary.length;
  let stage: DfuStage = "starting";
  const report = (bytesSent: number) =>
    onProgress?.({ stage, bytesSent, totalBytes: total });

  const decoder = new SlipDecoder();
  let closed = false;
  let ackWaiter: ((ack: number) => void) | null = null;
  let closeWaiter: (() => void) | null = null;

  link.subscribe({
    onData: (d) => {
      for (const frame of decoder.push(d)) {
        if (frame.length < 4) continue;
        // ACK frames are unreliable, zero-length, type 0.
        if ((frame[1] & 0x0f) !== 0) continue;
        const ack = (frame[0] >> 3) & 0x07;
        ackWaiter?.(ack);
      }
    },
    onClose: () => {
      closed = true;
      closeWaiter?.();
    },
  });

  let seq = 0;
  const sendReliable = async (payload: Uint8Array) => {
    seq = (seq + 1) % 8;
    const expectedAck = (seq + 1) % 8;
    const frame = buildHciFrame(seq, payload);
    for (let attempt = 1; ; attempt++) {
      throwIfAborted(signal, stage);
      if (closed) {
        throw new DfuError(
          "disconnected",
          "The serial port closed during the update.",
          {
            stage,
          },
        );
      }
      const acked = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          ackWaiter = null;
          closeWaiter = null;
          resolve(false);
        }, ackTimeout);
        ackWaiter = (ack) => {
          if (ack === expectedAck) {
            clearTimeout(timer);
            ackWaiter = null;
            closeWaiter = null;
            resolve(true);
          }
        };
        closeWaiter = () => {
          clearTimeout(timer);
          ackWaiter = null;
          resolve(false);
        };
      });
      try {
        await link.write(frame);
      } catch (e) {
        throw new DfuError("transport", `Serial write failed: ${String(e)}`, {
          stage,
          cause: e,
        });
      }
      if (await acked) return;
      if (attempt >= maxAttempts) {
        throw new DfuError(
          closed ? "disconnected" : "timeout",
          closed
            ? "The serial port closed during the update."
            : "The bootloader did not acknowledge a packet.",
          { stage },
        );
      }
    }
  };

  try {
    // START
    report(0);
    await sendReliable(
      concat(
        u32(DFU_START_PACKET),
        u32(DFU_UPDATE_MODE_APP),
        u32(0),
        u32(0),
        u32(total),
      ),
    );
    stage = "erasing";
    report(0);
    const pages = Math.floor(total / 4096) + 1;
    await sleep(Math.max(500, pages * pageEraseMs), signal);

    // INIT
    stage = "init";
    report(0);
    await sendReliable(
      concat(u32(DFU_INIT_PACKET), image.initPacket, new Uint8Array(2)),
    );

    // DATA
    stage = "uploading";
    let sent = 0;
    let count = 0;
    while (sent < total) {
      const chunk = image.binary.subarray(sent, sent + chunkSize);
      await sendReliable(concat(u32(DFU_DATA_PACKET), chunk));
      sent += chunk.length;
      report(sent);
      if (count % 8 === 0) await sleep(pageWriteMs, signal);
      count++;
    }
    await sleep(pageWriteMs, signal);

    // STOP -> validate + activate + reset
    stage = "activating";
    report(sent);
    await sendReliable(u32(DFU_STOP_DATA_PACKET));
    stage = "done";
    report(sent);
  } finally {
    await link.close().catch(() => undefined);
  }
}
