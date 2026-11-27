/**
 * Turns a user-supplied file (a `.uf2`, or a GitHub Actions artifact `.zip`
 * that contains one or more `.uf2`) into a DFU-ready image: binary + legacy
 * init packet, plus warnings the UI must surface before flashing.
 */
import { crc16Ccitt } from "./crc";
import {
  buildDfuPackageFiles,
  defaultInitPacketFields,
  encodeInitPacket,
} from "./initPacket";
import {
  parseUf2,
  uf2ToAppImage,
  XIAO_NRF52840_LAYOUT,
  type AppImage,
  type FlashLayout,
} from "./uf2";
import {
  isZip,
  listZipEntries,
  platformInflateRaw,
  readZipEntry,
  writeStoredZip,
  ZipError,
  type InflateRaw,
} from "./zip";

export interface FirmwareCandidate {
  /** File name of the .uf2 (base name inside a zip). */
  name: string;
  /** Path inside the zip, or the file name itself. */
  path: string;
  size: number;
  load: () => Promise<Uint8Array>;
}

/** List the .uf2 files a picked file contains (1 for a plain .uf2). */
export async function listFirmwareCandidates(
  fileName: string,
  data: Uint8Array,
  inflateRaw: InflateRaw = platformInflateRaw,
): Promise<FirmwareCandidate[]> {
  if (isZip(data)) {
    const entries = listZipEntries(data).filter(
      (e) =>
        !e.isDirectory &&
        /\.uf2$/i.test(e.name) &&
        !e.name.startsWith("__MACOSX/"),
    );
    if (entries.length === 0) {
      throw new ZipError("The zip does not contain any .uf2 file.");
    }
    return entries
      .map((e) => ({
        name: e.name.split("/").pop() ?? e.name,
        path: e.name,
        size: e.uncompressedSize,
        load: () => readZipEntry(data, e, inflateRaw),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  return [
    {
      name: fileName,
      path: fileName,
      size: data.length,
      load: async () => data,
    },
  ];
}

export type FirmwareWarning =
  /** settings_reset firmware: wipes bonds/keymap and has no update-mode key. */
  | "settings-reset"
  /** Image does not contain the &ota_dfu / &ser_dfu behaviors. */
  | "no-update-behavior";

export interface PreparedFirmware {
  name: string;
  image: AppImage;
  initPacket: Uint8Array;
  crc16: number;
  warnings: FirmwareWarning[];
  /** "left" / "right" guessed from the file name, for the UI hint. */
  half: "left" | "right" | null;
}

function containsAscii(haystack: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (haystack[i + j] !== n[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function guessHalf(name: string): "left" | "right" | null {
  const lower = name.toLowerCase();
  if (/(^|[^a-z])left([^a-z]|$)/.test(lower) || /_left/.test(lower))
    return "left";
  if (/(^|[^a-z])right([^a-z]|$)/.test(lower) || /_right/.test(lower))
    return "right";
  return null;
}

/** Parse + validate a UF2 and build the DFU binary and init packet. */
export function prepareFirmware(
  name: string,
  uf2: Uint8Array,
  layout: FlashLayout = XIAO_NRF52840_LAYOUT,
): PreparedFirmware {
  const image = uf2ToAppImage(parseUf2(uf2), layout);
  const fields = defaultInitPacketFields(image.binary);
  const warnings: FirmwareWarning[] = [];
  if (/settings[_-]?reset/i.test(name)) {
    warnings.push("settings-reset");
  }
  // Behavior devices are looked up by name, so a firmware that includes the
  // zmk-feature-ota-dfu behaviors carries the strings "otadfu" / "serdfu".
  if (
    !containsAscii(image.binary, "otadfu\0") &&
    !containsAscii(image.binary, "serdfu\0")
  ) {
    warnings.push("no-update-behavior");
  }
  return {
    name,
    image,
    initPacket: encodeInitPacket(fields),
    crc16: crc16Ccitt(image.binary),
    warnings,
    half: guessHalf(name),
  };
}

/** nrfutil-style DFU package for phone apps (nRF Connect / nRF DFU). */
export function buildDfuPackageZip(fw: PreparedFirmware): Uint8Array {
  return writeStoredZip(buildDfuPackageFiles(fw.image.binary));
}
