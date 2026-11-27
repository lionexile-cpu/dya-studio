import { crc16Ccitt } from "../crc";
import { defaultInitPacketFields, encodeInitPacket } from "../initPacket";
import {
  buildHciFrame,
  runSerialDfu,
  SlipDecoder,
  slipEncode,
  type SerialDfuLink,
} from "../serialDfu";

const instant = async () => {};

/** Fake bootloader: HCI/SLIP receiver of hci_transport.c + dfu_transport_serial.c. */
class FakeSerialBootloader implements SerialDfuLink {
  private dec = new SlipDecoder();
  private h: { onData: (d: Uint8Array) => void; onClose: () => void } | null =
    null;
  expectedSeq = 1;
  packets: { id: number; body: number[] }[] = [];
  writes = 0;
  closed = false;
  /** Drop these write indices (1-based) without ACK, to test retransmission. */
  drop = new Set<number>();
  goneAfterPackets = -1;

  subscribe(h: { onData: (d: Uint8Array) => void; onClose: () => void }) {
    this.h = h;
  }
  async close() {
    this.closed = true;
  }
  private ack() {
    const h0 = this.expectedSeq << 3;
    const hdr = [h0, 0, 0, (~h0 + 1) & 0xff];
    const out = slipEncode(Uint8Array.from(hdr));
    setTimeout(() => this.h?.onData(out), 0);
  }
  async write(data: Uint8Array) {
    this.writes++;
    if (this.drop.has(this.writes)) return;
    for (const f of this.dec.push(data)) {
      // header checks like is_rx_pkt_valid()
      expect(f[0] & 0x80).toBeTruthy();
      expect(f[1] & 0x0f).toBe(14);
      expect((f[0] + f[1] + f[2] + f[3]) & 0xff).toBe(0);
      const len = (f[1] >> 4) | (f[2] << 4);
      expect(f.length).toBe(4 + len + 2);
      const crc = crc16Ccitt(f.subarray(0, 4 + len));
      expect(f[4 + len] | (f[5 + len] << 8)).toBe(crc);
      const seq = f[0] & 7;
      if (seq === this.expectedSeq) {
        this.expectedSeq = (this.expectedSeq + 1) % 8;
        const v = new DataView(f.buffer, f.byteOffset + 4, len);
        this.packets.push({
          id: v.getUint32(0, true),
          body: Array.from(f.subarray(8, 4 + len)),
        });
        if (this.packets.length === this.goneAfterPackets) {
          setTimeout(() => this.h?.onClose(), 0);
          return;
        }
      }
      this.ack();
    }
  }
}

function image(size: number) {
  const binary = new Uint8Array(size).map((_, i) => (i * 31 + 0xc0) & 0xff);
  return {
    binary,
    initPacket: encodeInitPacket(defaultInitPacketFields(binary)),
  };
}

describe("SLIP / HCI framing", () => {
  it("escapes END and ESC bytes and decodes them back", () => {
    const raw = Uint8Array.from([1, 0xc0, 2, 0xdb, 3]);
    const enc = slipEncode(raw);
    expect(Array.from(enc)).toEqual([
      0xc0, 1, 0xdb, 0xdc, 2, 0xdb, 0xdd, 3, 0xc0,
    ]);
    const dec = new SlipDecoder();
    // split across chunks
    expect(dec.push(enc.subarray(0, 4))).toEqual([]);
    expect(dec.push(enc.subarray(4)).map((f) => Array.from(f))).toEqual([
      Array.from(raw),
    ]);
  });

  it("builds the same header as adafruit-nrfutil", () => {
    // seq 1, len 4: h0 = 1 | 2<<3 | 1<<6 | 1<<7 = 0xD1, h1 = 14 | 4<<4 = 0x4E
    const f = buildHciFrame(1, Uint8Array.from([5, 0, 0, 0]));
    const body = new SlipDecoder().push(f)[0];
    expect(Array.from(body.subarray(0, 4))).toEqual([
      0xd1,
      0x4e,
      0x00,
      (~(0xd1 + 0x4e) + 1) & 0xff,
    ]);
  });
});

describe("runSerialDfu (mocked serial port)", () => {
  it("sends START, INIT, DATA and STOP with sequence numbers and ACKs", async () => {
    const dev = new FakeSerialBootloader();
    const img = image(1500);
    await runSerialDfu(dev, img, { sleep: instant, chunkSize: 512 });
    const ids = dev.packets.map((p) => p.id);
    expect(ids).toEqual([3, 1, 4, 4, 4, 5]);
    const start = new DataView(Uint8Array.from(dev.packets[0].body).buffer);
    expect(start.getUint32(0, true)).toBe(4); // application mode
    expect(start.getUint32(12, true)).toBe(1500);
    expect(dev.packets[1].body).toEqual([...img.initPacket, 0, 0]);
    const data = dev.packets.filter((p) => p.id === 4).flatMap((p) => p.body);
    expect(data).toEqual(Array.from(img.binary));
    expect(dev.closed).toBe(true);
  });

  it("retransmits a packet that was not acknowledged", async () => {
    const dev = new FakeSerialBootloader();
    dev.drop = new Set([3]); // first DATA packet lost
    await runSerialDfu(dev, image(1024), { sleep: instant, ackTimeoutMs: 20 });
    expect(dev.writes).toBe(1 + 1 + 1 + 2 + 1); // start, init, data(lost), data x2, stop
    expect(dev.packets.filter((p) => p.id === 4)).toHaveLength(2);
  });

  it("fails with a timeout after repeated missing ACKs", async () => {
    const dev = new FakeSerialBootloader();
    dev.drop = new Set([1, 2, 3]);
    await expect(
      runSerialDfu(dev, image(64), {
        sleep: instant,
        ackTimeoutMs: 10,
        maxAttempts: 3,
      }),
    ).rejects.toMatchObject({ code: "timeout", stage: "starting" });
    expect(dev.closed).toBe(true);
  });

  it("reports a disconnect when the port goes away", async () => {
    const dev = new FakeSerialBootloader();
    dev.goneAfterPackets = 3;
    await expect(
      runSerialDfu(dev, image(2048), {
        sleep: instant,
        ackTimeoutMs: 20,
        maxAttempts: 2,
      }),
    ).rejects.toMatchObject({ code: "disconnected", stage: "uploading" });
  });

  it("can be cancelled", async () => {
    const dev = new FakeSerialBootloader();
    const ac = new AbortController();
    const p = runSerialDfu(dev, image(4096), {
      sleep: instant,
      signal: ac.signal,
      onProgress: (pr) => {
        if (pr.bytesSent >= 1024) ac.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ code: "aborted" });
    expect(dev.packets.some((x) => x.id === 5)).toBe(false);
  });
});
