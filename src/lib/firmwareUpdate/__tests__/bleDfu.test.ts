import { crc16Ccitt } from "../crc";
import { runLegacyBleDfu, type LegacyDfuLink } from "../bleDfu";
import { defaultInitPacketFields, encodeInitPacket } from "../initPacket";
import { DfuError, type DfuProgress } from "../types";

/**
 * Mocked GATT: a fake Adafruit bootloader implementing the legacy DFU state
 * machine of dfu_transport_ble.c closely enough to exercise the client.
 */
class FakeBootloader implements LegacyDfuLink {
  notify: (d: Uint8Array) => void = () => {};
  onDisc: () => void = () => {};
  pktType: "none" | "start" | "init" | "data" = "none";
  imageSize = 0;
  init: number[] = [];
  data: number[] = [];
  prn = 0;
  prnCount = 0;
  receipts = 0;
  activated = false;
  disconnected = false;
  controlLog: number[][] = [];
  /** Hooks to inject faults. */
  validateStatus = 1;
  dropPacketAt = -1;
  disconnectAtByte = -1;
  silentOnStart = false;
  receiptSkew = 0;
  private packetsSeen = 0;

  private emit(bytes: number[]) {
    const d = Uint8Array.from(bytes);
    // Notifications arrive asynchronously, like on a real link.
    setTimeout(() => this.notify(d), 0);
  }

  async subscribe(h: {
    onNotification: (d: Uint8Array) => void;
    onDisconnect: () => void;
  }) {
    this.notify = h.onNotification;
    this.onDisc = h.onDisconnect;
  }

  disconnect() {
    this.disconnected = true;
  }

  async writeControl(d: Uint8Array) {
    const op = Array.from(d);
    this.controlLog.push(op);
    switch (op[0]) {
      case 0x01:
        expect(op[1]).toBe(0x04);
        this.pktType = "start";
        break;
      case 0x02:
        if (op[1] === 0x00) {
          this.pktType = "init";
        } else {
          const crc = this.init[12] | (this.init[13] << 8);
          expect(this.init[0]).toBe(0x52);
          this.expectedCrc = crc;
          this.emit([0x10, 0x02, 0x01]);
        }
        break;
      case 0x08:
        this.prn = op[1] | (op[2] << 8);
        this.prnCount = this.prn;
        break;
      case 0x03:
        this.pktType = "data";
        break;
      case 0x04: {
        const ok = crc16Ccitt(Uint8Array.from(this.data)) === this.expectedCrc;
        this.emit([0x10, 0x04, ok ? this.validateStatus : 5]);
        break;
      }
      case 0x05:
        this.activated = true;
        setTimeout(() => this.onDisc(), 0);
        throw new Error("GATT Server is disconnected.");
      default:
        throw new Error("unexpected op " + op[0]);
    }
  }
  expectedCrc = -1;

  async writePacket(d: Uint8Array) {
    this.packetsSeen++;
    if (this.pktType === "start") {
      const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
      expect(d.length).toBe(12);
      expect(v.getUint32(0, true)).toBe(0);
      expect(v.getUint32(4, true)).toBe(0);
      this.imageSize = v.getUint32(8, true);
      if (!this.silentOnStart) this.emit([0x10, 0x01, 0x01]);
      return;
    }
    if (this.pktType === "init") {
      this.init.push(...d);
      return;
    }
    if (this.pktType === "data") {
      expect(d.length % 4).toBe(0);
      expect(d.length).toBeLessThanOrEqual(20);
      if (this.packetsSeen === this.dropPacketAt) return; // lost on air
      this.data.push(...d);
      if (
        this.disconnectAtByte >= 0 &&
        this.data.length >= this.disconnectAtByte
      ) {
        setTimeout(() => this.onDisc(), 0);
        return;
      }
      if (this.data.length === this.imageSize) {
        this.emit([0x10, 0x03, 0x01]);
      } else if (this.prn) {
        if (--this.prnCount === 0) {
          this.prnCount = this.prn;
          this.receipts++;
          const n = this.data.length + this.receiptSkew;
          this.emit([
            0x11,
            n & 0xff,
            (n >> 8) & 0xff,
            (n >> 16) & 0xff,
            (n >>> 24) & 0xff,
          ]);
        }
      }
    }
  }
}

function image(size: number) {
  const binary = new Uint8Array(size).map((_, i) => (i * 13) & 0xff);
  return {
    binary,
    initPacket: encodeInitPacket(defaultInitPacketFields(binary)),
  };
}

describe("runLegacyBleDfu (mocked GATT)", () => {
  it("performs a full update with packet receipt notifications", async () => {
    const dev = new FakeBootloader();
    const img = image(1000); // 50 packets of 20 bytes
    const progress: DfuProgress[] = [];
    await runLegacyBleDfu(dev, img, {
      prn: 8,
      onProgress: (p) => progress.push(p),
    });
    expect(dev.data).toEqual(Array.from(img.binary));
    expect(dev.init).toEqual(Array.from(img.initPacket));
    expect(dev.activated).toBe(true);
    expect(dev.disconnected).toBe(true);
    expect(dev.receipts).toBe(6); // after packets 8,16,...,48
    expect(dev.controlLog.map((c) => c[0])).toEqual([1, 2, 2, 8, 3, 4, 5]);
    expect(dev.controlLog[3]).toEqual([0x08, 8, 0]);
    const stages = [...new Set(progress.map((p) => p.stage))];
    expect(stages).toEqual([
      "starting",
      "erasing",
      "init",
      "uploading",
      "validating",
      "activating",
      "done",
    ]);
    expect(progress[progress.length - 1].bytesSent).toBe(1000);
  });

  it("handles an image whose packet count is a multiple of the PRN interval", async () => {
    const dev = new FakeBootloader();
    const img = image(400); // 20 packets, prn 10 -> no receipt after the last one
    await runLegacyBleDfu(dev, img, { prn: 10 });
    expect(dev.receipts).toBe(1);
    expect(dev.activated).toBe(true);
  });

  it("reports a CRC error from VALIDATE and does not activate", async () => {
    const dev = new FakeBootloader();
    dev.validateStatus = 6;
    await expect(runLegacyBleDfu(dev, image(200))).rejects.toMatchObject({
      code: "remote-error",
      status: 6,
      stage: "validating",
    });
    expect(dev.activated).toBe(false);
    expect(dev.disconnected).toBe(true);
  });

  it("times out when a lost packet delays the receipt notification", async () => {
    const dev = new FakeBootloader();
    dev.dropPacketAt = 5; // a data packet (1 start + 1 init packet precede it)
    await expect(
      runLegacyBleDfu(dev, image(1000), { prn: 10, responseTimeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "timeout", stage: "uploading" });
    expect(dev.activated).toBe(false);
  });

  it("detects a byte count mismatch in a receipt notification", async () => {
    const dev = new FakeBootloader();
    dev.receiptSkew = -20;
    await expect(
      runLegacyBleDfu(dev, image(1000), { prn: 10 }),
    ).rejects.toMatchObject({
      code: "protocol",
    });
    expect(dev.activated).toBe(false);
  });

  it("fails cleanly when the device disconnects mid-upload", async () => {
    const dev = new FakeBootloader();
    dev.disconnectAtByte = 300;
    const err = await runLegacyBleDfu(dev, image(1000), { prn: 5 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(DfuError);
    expect(err.code).toBe("disconnected");
    expect(err.stage).toBe("uploading");
  });

  it("times out when the bootloader never answers START", async () => {
    const dev = new FakeBootloader();
    dev.silentOnStart = true;
    await expect(
      runLegacyBleDfu(dev, image(100), { startTimeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "timeout", stage: "erasing" });
  });

  it("can be cancelled", async () => {
    const dev = new FakeBootloader();
    const ac = new AbortController();
    const p = runLegacyBleDfu(dev, image(4000), {
      signal: ac.signal,
      prn: 4,
      onProgress: (pr) => {
        if (pr.bytesSent >= 400) ac.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ code: "aborted" });
    expect(dev.activated).toBe(false);
    expect(dev.disconnected).toBe(true);
    // Cancel must not send SYSTEM_RESET: the bootloader should stay in DFU mode.
    expect(dev.controlLog.some((c) => c[0] === 0x06)).toBe(false);
  });

  it("rejects sizes that are not a multiple of 4", async () => {
    await expect(
      runLegacyBleDfu(new FakeBootloader(), {
        binary: new Uint8Array(6),
        initPacket: new Uint8Array(14),
      }),
    ).rejects.toMatchObject({ code: "protocol" });
  });
});
