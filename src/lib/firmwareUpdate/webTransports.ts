/**
 * Browser adapters for the DFU drivers: Web Serial (USB CDC of the bootloader
 * in serial DFU mode) and Web Bluetooth (bootloader in BLE OTA mode).
 *
 * Minimal structural types are declared here instead of relying on
 * @types/w3c-web-serial / @types/web-bluetooth, which this project does not
 * load globally.
 */
import {
  LEGACY_DFU_CONTROL_POINT,
  LEGACY_DFU_PACKET,
  LEGACY_DFU_SERVICE,
  type LegacyDfuLink,
} from "./bleDfu";
import type { SerialDfuLink } from "./serialDfu";
import { DfuError } from "./types";

/** USB vendor IDs of Adafruit-bootloader boards (Seeed, Adafruit, Nordic). */
export const BOOTLOADER_USB_VENDOR_IDS = [0x2886, 0x239a, 0x1915];

interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals?(signals: {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
  }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

interface SerialLike {
  requestPort(opts?: {
    filters?: { usbVendorId?: number }[];
  }): Promise<SerialPortLike>;
}

export function isWebSerialAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!(navigator as { serial?: unknown }).serial
  );
}

export function isWebBluetoothAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!(navigator as { bluetooth?: unknown }).bluetooth
  );
}

function isUserCancel(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === "NotFoundError" || e.name === "AbortError")
  );
}

export async function requestSerialDfuPort(
  showAllPorts: boolean,
): Promise<SerialPortLike> {
  const serial = (navigator as { serial?: SerialLike }).serial;
  if (!serial) {
    throw new DfuError(
      "unsupported",
      "This browser does not support Web Serial.",
    );
  }
  try {
    return await serial.requestPort(
      showAllPorts
        ? {}
        : {
            filters: BOOTLOADER_USB_VENDOR_IDS.map((usbVendorId) => ({
              usbVendorId,
            })),
          },
    );
  } catch (e) {
    if (isUserCancel(e))
      throw new DfuError("no-device", "No serial port was selected.");
    if (e instanceof Error && e.name === "SecurityError") {
      throw new DfuError("blocked", e.message, { cause: e });
    }
    throw new DfuError("transport", String(e), { cause: e });
  }
}

export async function openSerialDfuLink(
  port: SerialPortLike,
): Promise<SerialDfuLink> {
  try {
    await port.open({ baudRate: 115200 });
  } catch (e) {
    throw new DfuError(
      "transport",
      `Could not open the serial port: ${String(e)}`,
      {
        cause: e,
      },
    );
  }
  try {
    await port.setSignals?.({ dataTerminalReady: true, requestToSend: true });
  } catch {
    /* not fatal */
  }
  const writer = port.writable!.getWriter();
  const reader = port.readable!.getReader();
  const state: {
    handlers: { onData: (d: Uint8Array) => void; onClose: () => void } | null;
    closing: boolean;
  } = { handlers: null, closing: false };

  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) state.handlers?.onData(value);
      }
    } catch {
      /* port lost (device reset) */
    } finally {
      if (!state.closing) state.handlers?.onClose();
    }
  })();

  return {
    write: (data) => writer.write(data),
    subscribe: (h) => {
      state.handlers = h;
    },
    close: async () => {
      state.closing = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      await pump;
      try {
        reader.releaseLock();
        writer.releaseLock();
      } catch {
        /* ignore */
      }
      try {
        await port.close();
      } catch {
        /* the device may already be gone after reset */
      }
    },
  };
}

interface GattCharLike {
  writeValueWithResponse?(v: BufferSource): Promise<void>;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
  writeValue(v: BufferSource): Promise<void>;
  startNotifications(): Promise<unknown>;
  addEventListener(type: string, cb: (ev: Event) => void): void;
  value?: DataView;
}

interface BluetoothDeviceLike extends EventTarget {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{
        getCharacteristic(uuid: string): Promise<GattCharLike>;
      }>;
    }>;
    disconnect(): void;
  };
}

interface BluetoothLike {
  requestDevice(opts: unknown): Promise<BluetoothDeviceLike>;
}

/** Ask the user for the bootloader in OTA mode and open the DFU service. */
export async function connectBleDfu(): Promise<{
  link: LegacyDfuLink;
  name: string;
}> {
  const bluetooth = (navigator as { bluetooth?: BluetoothLike }).bluetooth;
  if (!bluetooth) {
    throw new DfuError(
      "unsupported",
      "This browser does not support Web Bluetooth.",
    );
  }
  let device: BluetoothDeviceLike;
  try {
    device = await bluetooth.requestDevice({
      filters: [{ services: [LEGACY_DFU_SERVICE] }, { namePrefix: "AdaDFU" }],
      optionalServices: [LEGACY_DFU_SERVICE],
    });
  } catch (e) {
    if (e instanceof Error && e.name === "SecurityError") {
      // Chrome's GATT blocklist lists 00001530-1212-efde-1523-785feabcd123.
      throw new DfuError("blocked", e.message, { cause: e });
    }
    if (isUserCancel(e))
      throw new DfuError("no-device", "No device was selected.");
    throw new DfuError("transport", String(e), { cause: e });
  }
  try {
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(LEGACY_DFU_SERVICE);
    const cp = await service.getCharacteristic(LEGACY_DFU_CONTROL_POINT);
    const pkt = await service.getCharacteristic(LEGACY_DFU_PACKET);
    const toBuf = (d: Uint8Array) => d.slice().buffer;
    const link: LegacyDfuLink = {
      writeControl: (d) =>
        cp.writeValueWithResponse
          ? cp.writeValueWithResponse(toBuf(d))
          : cp.writeValue(toBuf(d)),
      writePacket: (d) =>
        pkt.writeValueWithoutResponse
          ? pkt.writeValueWithoutResponse(toBuf(d))
          : pkt.writeValue(toBuf(d)),
      subscribe: async ({ onNotification, onDisconnect }) => {
        cp.addEventListener("characteristicvaluechanged", (ev) => {
          const v = (ev.target as unknown as GattCharLike).value;
          if (v)
            onNotification(
              new Uint8Array(
                v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength),
              ),
            );
        });
        device.addEventListener("gattserverdisconnected", () => onDisconnect());
        await cp.startNotifications();
      },
      disconnect: () => {
        if (device.gatt?.connected) device.gatt.disconnect();
      },
    };
    return { link, name: device.name ?? "AdaDFU" };
  } catch (e) {
    if (device.gatt?.connected) device.gatt.disconnect();
    if (e instanceof Error && e.name === "SecurityError") {
      throw new DfuError("blocked", e.message, { cause: e });
    }
    throw new DfuError(
      "transport",
      `Could not open the DFU service: ${String(e)}`,
      {
        cause: e,
      },
    );
  }
}
