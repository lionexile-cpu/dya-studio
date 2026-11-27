/**
 * Checksums used by the firmware updater.
 *
 * - {@link crc16Ccitt}: the CRC-16/CCITT variant (init 0xFFFF, no reflection)
 *   implemented by Nordic's SDK `crc16_compute()`. The Adafruit nRF52
 *   bootloader uses it both for the legacy DFU init packet's image CRC and for
 *   the HCI/SLIP serial transport frames. Byte-for-byte port of
 *   adafruit-nrfutil `nordicsemi/dfu/crc16.py`.
 * - {@link crc32}: the zip / PNG CRC-32 (reflected 0xEDB88320).
 */

export function crc16Ccitt(data: Uint8Array, initial = 0xffff): number {
  let crc = initial & 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc >> 8) & 0x00ff) | ((crc << 8) & 0xff00);
    crc ^= data[i];
    crc ^= (crc & 0x00ff) >> 4;
    crc ^= (crc << 8) << 4;
    crc ^= ((crc & 0x00ff) << 4) << 1;
    crc &= 0xffff;
  }
  return crc;
}

let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crc32Table = table;
  return table;
}

export function crc32(data: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
