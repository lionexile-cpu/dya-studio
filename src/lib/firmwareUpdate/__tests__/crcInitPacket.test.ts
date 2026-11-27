import { crc16Ccitt, crc32 } from "../crc";
import {
  buildDfuPackageFiles,
  defaultInitPacketFields,
  encodeInitPacket,
} from "../initPacket";

const ascii = (s: string) => new TextEncoder().encode(s);

describe("crc16Ccitt", () => {
  it("matches the CRC-16/CCITT-FALSE check value (Nordic crc16_compute)", () => {
    expect(crc16Ccitt(ascii("123456789"))).toBe(0x29b1);
  });
  it("returns the initial value for empty input", () => {
    expect(crc16Ccitt(new Uint8Array())).toBe(0xffff);
  });
  it("can be chained", () => {
    const a = ascii("1234");
    const b = ascii("56789");
    expect(crc16Ccitt(b, crc16Ccitt(a))).toBe(0x29b1);
  });
});

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
  });
});

describe("init packet", () => {
  it("encodes the adafruit-nrfutil dfu_ver 0.5 layout", () => {
    const bin = ascii("12345678");
    const fields = defaultInitPacketFields(bin);
    const pkt = encodeInitPacket(fields);
    const crc = crc16Ccitt(bin);
    expect(Array.from(pkt)).toEqual([
      0x52,
      0x00, // device type 0x0052
      0x68,
      0xce, // device revision 52840
      0xff,
      0xff,
      0xff,
      0xff, // app version
      0x01,
      0x00, // softdevice_len
      0xfe,
      0xff, // DFU_SOFTDEVICE_ANY
      crc & 0xff,
      crc >> 8,
    ]);
  });

  it("builds an nrfutil-style package manifest", () => {
    const bin = new Uint8Array(16).fill(1);
    const files = buildDfuPackageFiles(bin);
    expect(files.map((f) => f.name)).toEqual([
      "manifest.json",
      "application.bin",
      "application.dat",
    ]);
    const manifest = JSON.parse(new TextDecoder().decode(files[0].data));
    expect(manifest.manifest.dfu_version).toBe(0.5);
    expect(manifest.manifest.application.init_packet_data).toEqual({
      application_version: 0xffffffff,
      device_revision: 52840,
      device_type: 0x52,
      firmware_crc16: crc16Ccitt(bin),
      softdevice_req: [0xfffe],
    });
    expect(files[1].data).toBe(bin);
    expect(files[2].data.length).toBe(14);
  });
});
