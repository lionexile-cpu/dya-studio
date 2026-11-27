import { deflateRawSync, inflateRawSync } from "zlib";
import { crc32 } from "../crc";
import {
  isZip,
  listZipEntries,
  readZipEntry,
  writeStoredZip,
  ZipError,
} from "../zip";
import { listFirmwareCandidates } from "../firmwareImage";

const nodeInflate = async (d: Uint8Array) => new Uint8Array(inflateRawSync(d));
const arr = (u: Uint8Array) => Array.from(u);

/** Build a zip with deflate-compressed entries (like GitHub artifact zips). */
function makeDeflateZip(
  files: { name: string; data: Uint8Array }[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const comp = new Uint8Array(deflateRawSync(f.data));
    const loc = new Uint8Array(30 + name.length);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc32(f.data), true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    loc.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(f.data), true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(loc, comp);
    central.push(cen);
    offset += loc.length + comp.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("zip", () => {
  const a = new TextEncoder().encode("hello hello hello hello");
  const b = new Uint8Array(3000).map((_, i) => i & 0xff);

  it("round-trips a stored zip", async () => {
    const zip = writeStoredZip([
      { name: "a.txt", data: a },
      { name: "dir/b.bin", data: b },
    ]);
    expect(isZip(zip)).toBe(true);
    const entries = listZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "dir/b.bin"]);
    expect(arr(await readZipEntry(zip, entries[0], nodeInflate))).toEqual(
      arr(a),
    );
    expect(arr(await readZipEntry(zip, entries[1], nodeInflate))).toEqual(
      arr(b),
    );
  });

  it("reads deflate entries and checks the CRC", async () => {
    const zip = makeDeflateZip([{ name: "x.uf2", data: b }]);
    const [entry] = listZipEntries(zip);
    expect(entry.method).toBe(8);
    expect(arr(await readZipEntry(zip, entry, nodeInflate))).toEqual(arr(b));
    // corrupt the expected CRC
    await expect(
      readZipEntry(zip, { ...entry, crc32: entry.crc32 ^ 1 }, nodeInflate),
    ).rejects.toThrow(ZipError);
  });

  it("rejects non-zip input", () => {
    expect(isZip(new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(() => listZipEntries(new Uint8Array(100))).toThrow(ZipError);
  });

  it("lists the .uf2 files of a GitHub Actions artifact zip", async () => {
    const zip = makeDeflateZip([
      { name: "aerogu34_right.uf2", data: b },
      { name: "aerogu34_left.uf2", data: a },
      { name: "settings_reset.uf2", data: a },
      { name: "README.txt", data: a },
      { name: "__MACOSX/._aerogu34_left.uf2", data: a },
    ]);
    const c = await listFirmwareCandidates("firmware.zip", zip, nodeInflate);
    expect(c.map((x) => x.name)).toEqual([
      "aerogu34_left.uf2",
      "aerogu34_right.uf2",
      "settings_reset.uf2",
    ]);
    expect(arr(await c[1].load())).toEqual(arr(b));
  });

  it("errors when the zip has no .uf2", async () => {
    const zip = writeStoredZip([{ name: "a.txt", data: a }]);
    await expect(
      listFirmwareCandidates("x.zip", zip, nodeInflate),
    ).rejects.toThrow(/does not contain any \.uf2/);
  });

  it("passes a plain .uf2 through", async () => {
    const c = await listFirmwareCandidates("jisaku_1_left.uf2", b);
    expect(c).toHaveLength(1);
    expect(await c[0].load()).toBe(b);
  });
});
