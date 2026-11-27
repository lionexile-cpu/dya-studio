/**
 * UF2 parsing and validation for nRF52840 application images.
 *
 * The Adafruit nRF52 bootloader's DFU protocols (BLE OTA and serial) take a
 * plain binary without any address: the bootloader always writes it at the
 * start of the application region (CODE_REGION_1_START, right after the
 * SoftDevice). So before converting a UF2 into a DFU binary we must make sure
 * the UF2 really is an application image that starts exactly there and does
 * not reach into the ZMK settings storage or the bootloader.
 *
 * Flash layout of the Seeed XIAO nRF52840 (Zephyr
 * `nrf52840_partition_uf2_sdv7.dtsi`, Adafruit bootloader + S140 v7):
 *
 *   0x00000 - 0x27000  MBR + SoftDevice S140 7.x
 *   0x27000 - 0xEC000  Application (ZMK)
 *   0xEC000 - 0xF4000  Storage (ZMK settings: bonds, Studio keymap, ...)
 *   0xF4000 - 0x100000 Bootloader (+ MBR params / bootloader settings pages)
 */

export const UF2_MAGIC_START0 = 0x0a324655;
export const UF2_MAGIC_START1 = 0x9e5d5157;
export const UF2_MAGIC_END = 0x0ab16f30;
export const UF2_BLOCK_SIZE = 512;
export const UF2_FLAG_NOT_MAIN_FLASH = 0x00000001;
export const UF2_FLAG_FILE_CONTAINER = 0x00001000;
export const UF2_FLAG_FAMILY_ID_PRESENT = 0x00002000;

/** UF2 family ID of the nRF52840 (Microsoft UF2 families list). */
export const NRF52840_FAMILY_ID = 0xada52840;

export interface FlashLayout {
  /** First byte of the application region (end of the SoftDevice). */
  appStart: number;
  /** End (exclusive) of the application region; ZMK settings start here. */
  appEnd: number;
  /** Start of the bootloader region. */
  bootloaderStart: number;
  /** RAM range used to sanity-check the initial stack pointer. */
  ramStart: number;
  ramEnd: number;
}

/** XIAO nRF52840 / nice!nano style layout with S140 v7. */
export const XIAO_NRF52840_LAYOUT: FlashLayout = {
  appStart: 0x27000,
  appEnd: 0xec000,
  bootloaderStart: 0xf4000,
  ramStart: 0x20000000,
  ramEnd: 0x20040000,
};

export type Uf2ErrorCode =
  | "empty"
  | "bad-size"
  | "bad-magic"
  | "no-blocks"
  | "wrong-family"
  | "overlaps-softdevice"
  | "unexpected-start"
  | "overlaps-storage"
  | "overlaps-bootloader"
  | "bad-vector-table"
  | "bad-payload";

export class Uf2Error extends Error {
  readonly code: Uf2ErrorCode;
  readonly detail: Record<string, string | number>;
  constructor(
    code: Uf2ErrorCode,
    message: string,
    detail: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "Uf2Error";
    this.code = code;
    this.detail = detail;
  }
}

export interface Uf2Block {
  flags: number;
  targetAddr: number;
  payload: Uint8Array;
  blockNo: number;
  numBlocks: number;
  familyId: number | null;
}

export interface ParsedUf2 {
  blocks: Uf2Block[];
}

export interface AppImage {
  /** Flash address of the first byte of {@link binary}. */
  startAddress: number;
  /** End address (exclusive). */
  endAddress: number;
  /** Contiguous image, gaps filled with 0xFF, padded to a multiple of 4. */
  binary: Uint8Array;
  familyId: number;
  blockCount: number;
}

const hex = (n: number) => "0x" + n.toString(16).toUpperCase().padStart(5, "0");

/** Parse raw UF2 blocks. Throws {@link Uf2Error} on a malformed file. */
export function parseUf2(data: Uint8Array): ParsedUf2 {
  if (data.length === 0) throw new Uf2Error("empty", "The file is empty.");
  if (data.length % UF2_BLOCK_SIZE !== 0) {
    throw new Uf2Error(
      "bad-size",
      `UF2 size ${data.length} is not a multiple of 512 bytes.`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const blocks: Uf2Block[] = [];
  for (let off = 0; off < data.length; off += UF2_BLOCK_SIZE) {
    const m0 = view.getUint32(off, true);
    const m1 = view.getUint32(off + 4, true);
    const mEnd = view.getUint32(off + 508, true);
    if (
      m0 !== UF2_MAGIC_START0 ||
      m1 !== UF2_MAGIC_START1 ||
      mEnd !== UF2_MAGIC_END
    ) {
      throw new Uf2Error(
        "bad-magic",
        `Block ${off / UF2_BLOCK_SIZE} is not a valid UF2 block (bad magic).`,
        { block: off / UF2_BLOCK_SIZE },
      );
    }
    const flags = view.getUint32(off + 8, true);
    const targetAddr = view.getUint32(off + 12, true);
    const payloadSize = view.getUint32(off + 16, true);
    const blockNo = view.getUint32(off + 20, true);
    const numBlocks = view.getUint32(off + 24, true);
    const familyOrSize = view.getUint32(off + 28, true);
    if (payloadSize > 476) {
      throw new Uf2Error(
        "bad-payload",
        `Block ${blockNo} has an invalid payload size ${payloadSize}.`,
      );
    }
    blocks.push({
      flags,
      targetAddr,
      payload: data.subarray(off + 32, off + 32 + payloadSize),
      blockNo,
      numBlocks,
      familyId: flags & UF2_FLAG_FAMILY_ID_PRESENT ? familyOrSize : null,
    });
  }
  return { blocks };
}

/**
 * Turn a parsed UF2 into an application image suitable for legacy DFU, and
 * check that flashing it through the bootloader cannot touch the SoftDevice,
 * the ZMK settings storage or the bootloader.
 */
export function uf2ToAppImage(
  parsed: ParsedUf2,
  layout: FlashLayout = XIAO_NRF52840_LAYOUT,
): AppImage {
  const flashBlocks = parsed.blocks.filter(
    (b) =>
      !(b.flags & UF2_FLAG_NOT_MAIN_FLASH) &&
      !(b.flags & UF2_FLAG_FILE_CONTAINER),
  );
  if (flashBlocks.length === 0) {
    throw new Uf2Error("no-blocks", "The UF2 contains no flash data.");
  }
  const families = new Set(flashBlocks.map((b) => b.familyId));
  const ours = flashBlocks.filter((b) => b.familyId === NRF52840_FAMILY_ID);
  if (ours.length === 0) {
    const found = [...families]
      .map((f) => (f === null ? "none" : "0x" + f.toString(16)))
      .join(", ");
    throw new Uf2Error(
      "wrong-family",
      `This UF2 is not for the nRF52840 (family ID ${found}, expected 0xada52840).`,
      { family: found },
    );
  }

  let start = Infinity;
  let end = 0;
  for (const b of ours) {
    start = Math.min(start, b.targetAddr);
    end = Math.max(end, b.targetAddr + b.payload.length);
  }

  if (start < layout.appStart) {
    throw new Uf2Error(
      "overlaps-softdevice",
      `The image starts at ${hex(start)}, inside the MBR/SoftDevice region (< ${hex(layout.appStart)}). Updating the SoftDevice or bootloader over DFU is not supported here.`,
      { start: hex(start), appStart: hex(layout.appStart) },
    );
  }
  if (start !== layout.appStart) {
    throw new Uf2Error(
      "unexpected-start",
      `The image starts at ${hex(start)}, but the bootloader always writes DFU images at ${hex(layout.appStart)}. Flashing it would place the code at the wrong address.`,
      { start: hex(start), appStart: hex(layout.appStart) },
    );
  }
  if (end > layout.bootloaderStart) {
    throw new Uf2Error(
      "overlaps-bootloader",
      `The image reaches ${hex(end)}, into the bootloader region (>= ${hex(layout.bootloaderStart)}).`,
      { end: hex(end), bootloaderStart: hex(layout.bootloaderStart) },
    );
  }
  if (end > layout.appEnd) {
    throw new Uf2Error(
      "overlaps-storage",
      `The image reaches ${hex(end)}, into the settings storage (>= ${hex(layout.appEnd)}).`,
      { end: hex(end), appEnd: hex(layout.appEnd) },
    );
  }

  const length = Math.ceil((end - start) / 4) * 4;
  const binary = new Uint8Array(length).fill(0xff);
  for (const b of ours) {
    binary.set(b.payload, b.targetAddr - start);
  }

  // Cortex-M vector table sanity check: word 0 = initial SP (in RAM), word 1 =
  // reset handler (Thumb bit set, inside the image). The bootloader applies the
  // same plausibility test before jumping to an application.
  const v = new DataView(binary.buffer);
  const sp = v.getUint32(0, true);
  const reset = v.getUint32(4, true);
  const spOk = sp > layout.ramStart && sp <= layout.ramEnd && (sp & 3) === 0;
  const resetOk = (reset & 1) === 1 && reset >= start && reset < end;
  if (!spOk || !resetOk) {
    throw new Uf2Error(
      "bad-vector-table",
      `The image does not start with a valid application vector table (SP ${hex(sp)}, reset ${hex(reset)}).`,
      { sp: hex(sp), reset: hex(reset) },
    );
  }

  return {
    startAddress: start,
    endAddress: end,
    binary,
    familyId: NRF52840_FAMILY_ID,
    blockCount: ours.length,
  };
}
