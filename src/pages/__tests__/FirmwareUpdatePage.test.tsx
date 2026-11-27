import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LanguageProvider } from "../../contexts/LanguageContext";
import { FirmwareUpdatePage } from "../FirmwareUpdatePage";
import {
  makeAppBinary,
  makeUf2,
} from "../../lib/firmwareUpdate/testUtils/uf2Fixtures";
import { SlipDecoder, slipEncode } from "../../lib/firmwareUpdate/serialDfu";

function renderPage(lang: "en" | "ja" = "en") {
  localStorage.setItem("dya-studio-language", lang);
  return render(
    <LanguageProvider>
      <FirmwareUpdatePage onBack={jest.fn()} />
    </LanguageProvider>,
  );
}

function uploadUf2(name: string, extra = "otadfu\0serdfu\0") {
  const uf2 = makeUf2(makeAppBinary(512, extra));
  const file = new File([uf2], name);
  fireEvent.change(screen.getByTestId("fw-file-input"), {
    target: { files: [file] },
  });
}

/** A Web Serial port backed by a minimal fake bootloader that ACKs frames. */
function fakeSerialPort() {
  const packetIds: number[] = [];
  let enqueue: (d: Uint8Array) => void = () => {};
  let expected = 1;
  const dec = new SlipDecoder();
  const port = {
    open: jest.fn(async () => {}),
    close: jest.fn(async () => {}),
    setSignals: jest.fn(async () => {}),
    getInfo: () => ({ usbVendorId: 0x2886, usbProductId: 0x0044 }),
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        enqueue = (d) => c.enqueue(d);
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        for (const f of dec.push(chunk)) {
          if ((f[0] & 7) === expected) {
            expected = (expected + 1) % 8;
            packetIds.push(f[4]);
          }
          const h0 = expected << 3;
          enqueue(slipEncode(Uint8Array.from([h0, 0, 0, (~h0 + 1) & 0xff])));
        }
      },
    }),
  };
  return { port, packetIds };
}

afterEach(() => {
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    writable: true,
    value: undefined,
  });
});

describe("FirmwareUpdatePage", () => {
  it("shows the guided steps in Japanese", () => {
    renderPage("ja");
    expect(
      screen.getByText("1. 更新したいハーフを更新モードにする"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2. ファームウェアファイルを選ぶ"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("3. 更新モードのデバイスに接続する"),
    ).toBeInTheDocument();
    expect(screen.getByText("4. 書き込む")).toBeInTheDocument();
    expect(screen.getByText("5. 再起動を待つ")).toBeInTheDocument();
  });

  it("validates a UF2 and requires acknowledging warnings", async () => {
    renderPage("en");
    uploadUf2("settings_reset.uf2", "");
    await screen.findByTestId("fw-info");
    expect(
      screen.getByText(/settings_reset erases settings/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not contain the update-mode behaviors/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /I understand/ }),
    ).not.toBeChecked();
  });

  it("rejects a UF2 for another chip", async () => {
    renderPage("en");
    const uf2 = makeUf2(makeAppBinary(512), { family: 0xe48bff56 });
    fireEvent.change(screen.getByTestId("fw-file-input"), {
      target: { files: [new File([uf2], "rp2040.uf2")] },
    });
    expect(await screen.findByText(/not for the nRF52840/)).toBeInTheDocument();
  });

  it("explains the Chrome blocklist for the Web Bluetooth method", () => {
    renderPage("en");
    fireEvent.click(
      screen.getByRole("radio", { name: /this browser, experimental/ }),
    );
    expect(
      screen.getByText(/Chrome blocks the legacy Nordic DFU service/),
    ).toBeInTheDocument();
  });

  it("flashes over Web Serial end to end", async () => {
    const { port, packetIds } = fakeSerialPort();
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      writable: true,
      value: { requestPort: jest.fn(async () => port) },
    });
    renderPage("en");
    uploadUf2("aerogu34_right.uf2");
    await screen.findByTestId("fw-info");
    expect(screen.getByText(/suggests the right half/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Select serial port/ }),
      );
    });
    expect(
      await screen.findByText(/Connected: USB 2886:0044/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start update" }));
    await waitFor(
      () => expect(screen.getByText(/Flashing finished/)).toBeInTheDocument(),
      {
        timeout: 4000,
      },
    );
    // START, INIT, one 512-byte DATA packet, STOP
    expect(packetIds).toEqual([3, 1, 4, 5]);
  });
});
