/**
 * Legacy (Nordic SDK 11) DFU init packet, as produced by
 * `adafruit-nrfutil dfu genpkg` with the default `dfu_ver` 0.5:
 *
 *   uint16 device_type      0x0052 (ADAFRUIT_DEVICE_TYPE, checked by the bootloader)
 *   uint16 device_rev       52840  (only checked for SoftDevice/bootloader updates)
 *   uint32 app_version      0xFFFFFFFF
 *   uint16 softdevice_len   1
 *   uint16 softdevice[1]    0xFFFE (DFU_SOFTDEVICE_ANY)
 *   uint16 image_crc16      CRC-16/CCITT of the binary (dfu_init_postvalidate)
 *
 * All little-endian; 14 bytes total. The bootloader's dfu_init_prevalidate()
 * rejects a device_type other than 0x0052 with NRF_ERROR_FORBIDDEN.
 */
import { crc16Ccitt } from "./crc";

export const ADAFRUIT_DEVICE_TYPE = 0x0052;
export const NRF52840_DEVICE_REV = 52840;
export const DFU_SOFTDEVICE_ANY = 0xfffe;
export const APP_VERSION_ANY = 0xffffffff;

export interface InitPacketFields {
  deviceType: number;
  deviceRevision: number;
  appVersion: number;
  softdeviceReq: number[];
  firmwareCrc16: number;
}

export function defaultInitPacketFields(binary: Uint8Array): InitPacketFields {
  return {
    deviceType: ADAFRUIT_DEVICE_TYPE,
    deviceRevision: NRF52840_DEVICE_REV,
    appVersion: APP_VERSION_ANY,
    softdeviceReq: [DFU_SOFTDEVICE_ANY],
    firmwareCrc16: crc16Ccitt(binary),
  };
}

export function encodeInitPacket(fields: InitPacketFields): Uint8Array {
  const len = 2 + 2 + 4 + 2 + fields.softdeviceReq.length * 2 + 2;
  const out = new Uint8Array(len);
  const v = new DataView(out.buffer);
  let o = 0;
  v.setUint16(o, fields.deviceType, true);
  o += 2;
  v.setUint16(o, fields.deviceRevision, true);
  o += 2;
  v.setUint32(o, fields.appVersion >>> 0, true);
  o += 4;
  v.setUint16(o, fields.softdeviceReq.length, true);
  o += 2;
  for (const sd of fields.softdeviceReq) {
    v.setUint16(o, sd, true);
    o += 2;
  }
  v.setUint16(o, fields.firmwareCrc16, true);
  return out;
}

/**
 * nrfutil-compatible DFU package (manifest.json + application.bin/.dat),
 * accepted by nRF Connect / nRF Device Firmware Update / nRF Toolbox in
 * legacy DFU mode.
 */
export function buildDfuPackageFiles(
  binary: Uint8Array,
  fields: InitPacketFields = defaultInitPacketFields(binary),
): { name: string; data: Uint8Array }[] {
  const manifest = {
    manifest: {
      application: {
        bin_file: "application.bin",
        dat_file: "application.dat",
        init_packet_data: {
          application_version: fields.appVersion >>> 0,
          device_revision: fields.deviceRevision,
          device_type: fields.deviceType,
          firmware_crc16: fields.firmwareCrc16,
          softdevice_req: fields.softdeviceReq,
        },
      },
      dfu_version: 0.5,
    },
  };
  return [
    {
      name: "manifest.json",
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 4)),
    },
    { name: "application.bin", data: binary },
    { name: "application.dat", data: encodeInitPacket(fields) },
  ];
}
