/** Helpers to synthesize UF2 files for tests. */
import {
  NRF52840_FAMILY_ID,
  UF2_FLAG_FAMILY_ID_PRESENT,
  UF2_MAGIC_END,
  UF2_MAGIC_START0,
  UF2_MAGIC_START1,
} from "../uf2";

export function makeAppBinary(size: number, extra = ""): Uint8Array {
  const bin = new Uint8Array(size);
  for (let i = 0; i < size; i++) bin[i] = (i * 7 + 3) & 0xff;
  const v = new DataView(bin.buffer);
  v.setUint32(0, 0x20040000, true); // initial SP = end of RAM
  v.setUint32(4, 0x27000 + 0x101, true); // reset handler (Thumb)
  if (extra) bin.set(Array.from(new TextEncoder().encode(extra)), 0x100);
  return bin;
}

export function makeUf2(
  binary: Uint8Array,
  opts: { start?: number; family?: number | null; payload?: number } = {},
): Uint8Array {
  const start = opts.start ?? 0x27000;
  const family = opts.family === undefined ? NRF52840_FAMILY_ID : opts.family;
  const payload = opts.payload ?? 256;
  const n = Math.ceil(binary.length / payload);
  const out = new Uint8Array(n * 512);
  const v = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    const o = i * 512;
    v.setUint32(o, UF2_MAGIC_START0, true);
    v.setUint32(o + 4, UF2_MAGIC_START1, true);
    v.setUint32(o + 8, family === null ? 0 : UF2_FLAG_FAMILY_ID_PRESENT, true);
    v.setUint32(o + 12, start + i * payload, true);
    v.setUint32(o + 16, payload, true);
    v.setUint32(o + 20, i, true);
    v.setUint32(o + 24, n, true);
    v.setUint32(o + 28, family ?? 0, true);
    const chunk = binary.subarray(i * payload, (i + 1) * payload);
    out.set(chunk, o + 32);
    if (chunk.length < payload)
      out.fill(0xff, o + 32 + chunk.length, o + 32 + payload);
    v.setUint32(o + 508, UF2_MAGIC_END, true);
  }
  return out;
}
