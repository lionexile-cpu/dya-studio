import { parseUf2, uf2ToAppImage, Uf2Error } from "../uf2";
import { makeAppBinary, makeUf2 } from "../testUtils/uf2Fixtures";

function expectUf2Error(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(Uf2Error);
    expect((e as Uf2Error).code).toBe(code);
    return;
  }
  throw new Error("expected Uf2Error " + code);
}

describe("parseUf2 / uf2ToAppImage", () => {
  it("converts a ZMK-style UF2 to a contiguous binary at 0x27000", () => {
    const bin = makeAppBinary(1000);
    const img = uf2ToAppImage(parseUf2(makeUf2(bin)));
    expect(img.startAddress).toBe(0x27000);
    expect(img.endAddress).toBe(0x27000 + 1024); // 4 x 256-byte blocks
    expect(img.binary.length).toBe(1024);
    expect(Array.from(img.binary.subarray(0, 1000))).toEqual(Array.from(bin));
    expect(img.binary.subarray(1000).every((b) => b === 0xff)).toBe(true);
    expect(img.blockCount).toBe(4);
  });

  it("orders out-of-order blocks and fills gaps with 0xFF", () => {
    const bin = makeAppBinary(768);
    const uf2 = makeUf2(bin);
    // swap block 0 and 2
    const b0 = uf2.slice(0, 512);
    uf2.set(uf2.slice(1024, 1536), 0);
    uf2.set(b0, 1024);
    // drop the middle block -> gap
    const parsed = parseUf2(uf2);
    parsed.blocks = parsed.blocks.filter((b) => b.targetAddr !== 0x27100);
    const img = uf2ToAppImage(parsed);
    expect(img.binary.length).toBe(768);
    expect(img.binary.subarray(256, 512).every((b) => b === 0xff)).toBe(true);
    expect(img.binary[0]).toBe(bin[0]);
    expect(img.binary[600]).toBe(bin[600]);
  });

  it("rejects non-UF2 data", () => {
    expectUf2Error(() => parseUf2(new Uint8Array(512)), "bad-magic");
    expectUf2Error(() => parseUf2(new Uint8Array(100)), "bad-size");
    expectUf2Error(() => parseUf2(new Uint8Array()), "empty");
  });

  it("rejects other chip families", () => {
    const uf2 = makeUf2(makeAppBinary(256), { family: 0xe48bff56 }); // RP2040
    expectUf2Error(() => uf2ToAppImage(parseUf2(uf2)), "wrong-family");
    const noFamily = makeUf2(makeAppBinary(256), { family: null });
    expectUf2Error(() => uf2ToAppImage(parseUf2(noFamily)), "wrong-family");
  });

  it("rejects images that would overwrite the SoftDevice", () => {
    const uf2 = makeUf2(makeAppBinary(512), { start: 0x26000 });
    expectUf2Error(() => uf2ToAppImage(parseUf2(uf2)), "overlaps-softdevice");
  });

  it("rejects images that do not start at the application start", () => {
    const uf2 = makeUf2(makeAppBinary(512), { start: 0x30000 });
    expectUf2Error(() => uf2ToAppImage(parseUf2(uf2)), "unexpected-start");
  });

  it("rejects images reaching the settings storage or the bootloader", () => {
    const tooBig = makeUf2(makeAppBinary(0xec000 - 0x27000 + 256));
    expectUf2Error(() => uf2ToAppImage(parseUf2(tooBig)), "overlaps-storage");
    const intoBl = makeUf2(makeAppBinary(0xf4000 - 0x27000 + 256));
    expectUf2Error(
      () => uf2ToAppImage(parseUf2(intoBl)),
      "overlaps-bootloader",
    );
  });

  it("accepts an image that fills the application region exactly", () => {
    const img = uf2ToAppImage(
      parseUf2(makeUf2(makeAppBinary(0xec000 - 0x27000))),
    );
    expect(img.endAddress).toBe(0xec000);
  });

  it("rejects an image without a plausible vector table", () => {
    const bin = makeAppBinary(512);
    new DataView(bin.buffer).setUint32(0, 0xffffffff, true);
    expectUf2Error(
      () => uf2ToAppImage(parseUf2(makeUf2(bin))),
      "bad-vector-table",
    );
  });
});
