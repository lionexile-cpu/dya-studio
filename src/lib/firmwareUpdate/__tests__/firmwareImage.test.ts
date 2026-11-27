import { crc16Ccitt } from "../crc";
import {
  buildDfuPackageZip,
  guessHalf,
  prepareFirmware,
} from "../firmwareImage";
import { listZipEntries } from "../zip";
import { makeAppBinary, makeUf2 } from "../testUtils/uf2Fixtures";

describe("prepareFirmware", () => {
  it("builds binary, init packet and detects the update behaviors", () => {
    const uf2 = makeUf2(makeAppBinary(2048, "otadfu\0serdfu\0"));
    const fw = prepareFirmware("aerogu34_right.uf2", uf2);
    expect(fw.image.binary.length).toBe(2048);
    expect(fw.crc16).toBe(crc16Ccitt(fw.image.binary));
    expect(fw.initPacket[12] | (fw.initPacket[13] << 8)).toBe(fw.crc16);
    expect(fw.warnings).toEqual([]);
    expect(fw.half).toBe("right");
  });

  it("warns about settings_reset and firmware without the update behaviors", () => {
    const fw = prepareFirmware(
      "settings_reset.uf2",
      makeUf2(makeAppBinary(512)),
    );
    expect(fw.warnings).toEqual(["settings-reset", "no-update-behavior"]);
  });

  it("builds a phone DFU package", () => {
    const fw = prepareFirmware(
      "jisaku_1_left.uf2",
      makeUf2(makeAppBinary(512, "otadfu\0")),
    );
    const zip = buildDfuPackageZip(fw);
    expect(listZipEntries(zip).map((e) => e.name)).toEqual([
      "manifest.json",
      "application.bin",
      "application.dat",
    ]);
  });
});

describe("guessHalf", () => {
  it.each([
    ["aerogu34_left.uf2", "left"],
    ["aerogu34_right_prospector.uf2", "right"],
    ["jisaku_1_left-xiao_ble.uf2", "left"],
    ["settings_reset.uf2", null],
  ])("%s -> %s", (name, half) => {
    expect(guessHalf(name)).toBe(half);
  });
});
