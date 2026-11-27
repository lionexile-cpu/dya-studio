/**
 * Minimal zip reader / writer.
 *
 * Only what the firmware updater needs:
 * - read the GitHub Actions artifact `.zip` (stored or deflate entries) to
 *   pick a `.uf2` out of it, and
 * - write a "stored" (uncompressed) zip for the nrfutil-style DFU package that
 *   phone apps (nRF Connect / nRF Device Firmware Update) accept.
 *
 * Deflate is delegated to the platform's `DecompressionStream("deflate-raw")`
 * (Chrome 80+, Node 18+), so no third-party zip library is bundled. ZIP64,
 * encryption and multi-disk archives are rejected.
 */
import { crc32 } from "./crc";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  /** Offset of the local file header. */
  localHeaderOffset: number;
  isDirectory: boolean;
}

export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array>;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export function isZip(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    (data[2] === 0x03 || data[2] === 0x05) &&
    (data[3] === 0x04 || data[3] === 0x06)
  );
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  // CP437 for plain ASCII names is identical; good enough for file names we
  // care about (*.uf2).
  return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
}

/** List the entries of a zip archive from its central directory. */
export function listZipEntries(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const minEocd = 22;
  if (data.length < minEocd) throw new ZipError("Not a zip file (too short).");
  let eocd = -1;
  const lowest = Math.max(0, data.length - (minEocd + 0xffff));
  for (let i = data.length - minEocd; i >= lowest; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new ZipError("Not a zip file (no end of central directory).");
  const disk = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const total = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || cdDisk !== 0)
    throw new ZipError("Multi-disk zip files are not supported.");
  if (total === 0xffff || cdOffset === 0xffffffff) {
    throw new ZipError("ZIP64 archives are not supported.");
  }
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > data.length || view.getUint32(p, true) !== SIG_CEN) {
      throw new ZipError("Corrupt zip central directory.");
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const name = decodeName(
      data.subarray(p + 46, p + 46 + nameLen),
      (flags & 0x800) !== 0,
    );
    if (flags & 0x1)
      throw new ZipError(`Encrypted zip entries are not supported (${name}).`);
    entries.push({
      name,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith("/"),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Platform deflate-raw decoder (browser / Node 18+). */
export const platformInflateRaw: InflateRaw = async (data) => {
  if (typeof DecompressionStream === "undefined") {
    throw new ZipError(
      "This browser cannot decompress zip files (no DecompressionStream).",
    );
  }
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Extract one entry's contents and verify its CRC-32. */
export async function readZipEntry(
  data: Uint8Array,
  entry: ZipEntry,
  inflateRaw: InflateRaw = platformInflateRaw,
): Promise<Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const p = entry.localHeaderOffset;
  if (p + 30 > data.length || view.getUint32(p, true) !== SIG_LOC) {
    throw new ZipError(`Corrupt local header for ${entry.name}.`);
  }
  const nameLen = view.getUint16(p + 26, true);
  const extraLen = view.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  const raw = data.subarray(start, start + entry.compressedSize);
  if (raw.length !== entry.compressedSize) {
    throw new ZipError(`Truncated zip entry ${entry.name}.`);
  }
  let out: Uint8Array;
  if (entry.method === 0) {
    out = raw.slice();
  } else if (entry.method === 8) {
    out = await inflateRaw(raw);
  } else {
    throw new ZipError(
      `Unsupported compression method ${entry.method} for ${entry.name}.`,
    );
  }
  if (out.length !== entry.uncompressedSize) {
    throw new ZipError(`Size mismatch while extracting ${entry.name}.`);
  }
  if (crc32(out) !== entry.crc32) {
    throw new ZipError(`CRC mismatch while extracting ${entry.name}.`);
  }
  return out;
}

export interface ZipInputFile {
  name: string;
  data: Uint8Array;
}

/** Build an uncompressed ("stored") zip archive. */
export function writeStoredZip(files: ZipInputFile[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  // Fixed DOS timestamp 1980-01-01 00:00 for reproducible output.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const loc = new Uint8Array(30 + name.length);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, SIG_LOC, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    loc.set(name, 30);
    locals.push(loc, f.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, SIG_CEN, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    centrals.push(cen);
    offset += loc.length + f.data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}
