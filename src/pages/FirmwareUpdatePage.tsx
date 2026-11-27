import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBluetooth,
  IconCheck,
  IconDeviceMobile,
  IconDownload,
  IconFileUpload,
  IconUsb,
} from "@tabler/icons-react";
import { useLanguage } from "../hooks/useLanguage";
import { LanguageToggle } from "../components/LanguageToggle";
import { fwText, type FirmwareUpdateKey } from "../i18n/firmwareUpdateStrings";
import {
  buildDfuPackageZip,
  listFirmwareCandidates,
  prepareFirmware,
  type FirmwareCandidate,
  type PreparedFirmware,
} from "../lib/firmwareUpdate/firmwareImage";
import {
  runLegacyBleDfu,
  type LegacyDfuLink,
} from "../lib/firmwareUpdate/bleDfu";
import {
  runSerialDfu,
  type SerialDfuLink,
} from "../lib/firmwareUpdate/serialDfu";
import {
  connectBleDfu,
  openSerialDfuLink,
  requestSerialDfuPort,
} from "../lib/firmwareUpdate/webTransports";
import { DfuError, type DfuProgress } from "../lib/firmwareUpdate/types";

export { FIRMWARE_UPDATE_PATH } from "../lib/firmwareUpdate/routes";

export type UpdateMethod = "serial" | "phone" | "ble";

type Link =
  | { kind: "serial"; link: SerialDfuLink; name: string }
  | { kind: "ble"; link: LegacyDfuLink; name: string };

type RunState =
  | { phase: "idle" }
  | { phase: "running"; progress: DfuProgress }
  | { phase: "done" }
  | { phase: "error"; error: DfuError };

function Step({
  title,
  children,
  active,
}: {
  title: string;
  children: ReactNode;
  active: boolean;
}) {
  return (
    <section
      className={`glass-card p-5 mb-4 transition-opacity ${active ? "" : "opacity-60"}`}
    >
      <h2 className="text-base font-medium text-[var(--color-text)] mb-2">
        {title}
      </h2>
      <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}

function Notice({
  children,
  tone = "warn",
}: {
  children: ReactNode;
  tone?: "warn" | "info";
}) {
  const color =
    tone === "warn" ? "var(--color-warning, #f59e0b)" : "var(--color-electric)";
  return (
    <div
      className="rounded-lg p-3 text-sm flex gap-2 items-start"
      style={{
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <IconAlertTriangle
        size={16}
        className="mt-0.5 flex-shrink-0"
        style={{ color }}
      />
      <div>{children}</div>
    </div>
  );
}

function hex(n: number) {
  return n.toString(16).toUpperCase();
}

function downloadBytes(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: "application/zip" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** File -> bytes (FileReader fallback for environments without Blob.arrayBuffer). */
function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function errorDetail(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function FirmwareUpdatePage({ onBack }: { onBack: () => void }) {
  const { language } = useLanguage();
  const tx = (
    key: FirmwareUpdateKey,
    params?: Record<string, string | number>,
  ) => fwText(language, key, params);

  const [method, setMethod] = useState<UpdateMethod>("serial");
  const [candidates, setCandidates] = useState<FirmwareCandidate[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [firmware, setFirmware] = useState<PreparedFirmware | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [showAllPorts, setShowAllPorts] = useState(false);
  const [link, setLink] = useState<Link | null>(null);
  const [connectError, setConnectError] = useState<DfuError | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const linkRef = useRef<Link | null>(null);

  useEffect(() => {
    linkRef.current = link;
  }, [link]);

  // Release the port / GATT connection when leaving the page.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      const l = linkRef.current;
      if (l?.kind === "serial") void l.link.close();
      if (l?.kind === "ble") l.link.disconnect();
    },
    [],
  );

  const releaseLink = () => {
    if (link?.kind === "serial") void link.link.close();
    if (link?.kind === "ble") link.link.disconnect();
    setLink(null);
  };

  const selectCandidate = async (list: FirmwareCandidate[], path: string) => {
    setSelectedPath(path);
    setFirmware(null);
    setAcknowledged(false);
    setRun({ phase: "idle" });
    const c = list.find((x) => x.path === path);
    if (!c) return;
    try {
      setFirmware(prepareFirmware(c.name, await c.load()));
      setFileError(null);
    } catch (e) {
      setFileError(tx("errFile", { detail: errorDetail(e) }));
    }
  };

  const onFile = async (file: File | undefined) => {
    setCandidates([]);
    setFirmware(null);
    setFileError(null);
    if (!file) return;
    try {
      const bytes = await readFileBytes(file);
      const list = await listFirmwareCandidates(file.name, bytes);
      setCandidates(list);
      await selectCandidate(list, list[0].path);
    } catch (e) {
      setFileError(tx("errFile", { detail: errorDetail(e) }));
    }
  };

  const changeMethod = (m: UpdateMethod) => {
    if (run.phase === "running") return;
    releaseLink();
    setConnectError(null);
    setRun({ phase: "idle" });
    setMethod(m);
  };

  const connect = async () => {
    setConnectError(null);
    setConnecting(true);
    releaseLink();
    try {
      if (method === "serial") {
        const port = await requestSerialDfuPort(showAllPorts);
        const serialLink = await openSerialDfuLink(port);
        const info = port.getInfo?.();
        const name = info?.usbVendorId
          ? `USB ${hex(info.usbVendorId).padStart(4, "0")}:${hex(info.usbProductId ?? 0).padStart(4, "0")}`
          : "Serial";
        setLink({ kind: "serial", link: serialLink, name });
      } else {
        const { link: bleLink, name } = await connectBleDfu();
        setLink({ kind: "ble", link: bleLink, name });
      }
    } catch (e) {
      setConnectError(
        e instanceof DfuError ? e : new DfuError("transport", errorDetail(e)),
      );
    } finally {
      setConnecting(false);
    }
  };

  const start = async () => {
    if (!firmware || !link) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const total = firmware.image.binary.length;
    setRun({
      phase: "running",
      progress: { stage: "starting", bytesSent: 0, totalBytes: total },
    });
    const image = {
      binary: firmware.image.binary,
      initPacket: firmware.initPacket,
    };
    const onProgress = (progress: DfuProgress) =>
      setRun({ phase: "running", progress });
    try {
      if (link.kind === "serial") {
        await runSerialDfu(link.link, image, { signal: ac.signal, onProgress });
      } else {
        await runLegacyBleDfu(link.link, image, {
          signal: ac.signal,
          onProgress,
        });
      }
      setRun({ phase: "done" });
    } catch (e) {
      setRun({
        phase: "error",
        error:
          e instanceof DfuError ? e : new DfuError("transport", errorDetail(e)),
      });
    } finally {
      abortRef.current = null;
      // Both drivers close/disconnect the link when they finish or fail; a
      // retry starts from "connect" again (serial ports must be re-opened).
      setLink(null);
    }
  };

  const errorText = (e: DfuError) =>
    tx(`err_${e.code}` as FirmwareUpdateKey, { detail: e.message });

  const needsAck = (firmware?.warnings.length ?? 0) > 0;
  const fileReady = !!firmware && (!needsAck || acknowledged);
  const running = run.phase === "running";

  const methods: {
    id: UpdateMethod;
    icon: ReactNode;
    label: FirmwareUpdateKey;
    desc: FirmwareUpdateKey;
  }[] = [
    {
      id: "serial",
      icon: <IconUsb size={18} />,
      label: "methodSerial",
      desc: "methodSerialDesc",
    },
    {
      id: "phone",
      icon: <IconDeviceMobile size={18} />,
      label: "methodPhone",
      desc: "methodPhoneDesc",
    },
    {
      id: "ble",
      icon: <IconBluetooth size={18} />,
      label: "methodBle",
      desc: "methodBleDesc",
    },
  ];

  const progressPercent =
    run.phase === "running" && run.progress.totalBytes > 0
      ? Math.floor((run.progress.bytesSent / run.progress.totalBytes) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-[var(--color-bg)]">
      <div className="absolute inset-0 bg-gradient-cyber opacity-20 pointer-events-none" />
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <span className="text-lg font-light tracking-widest text-[var(--color-text)]">
            {tx("title")}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              disabled={running}
              className="btn-ghost border border-[var(--color-border)] flex items-center gap-2 text-sm"
            >
              <IconArrowLeft size={18} />
              <span className="hidden sm:inline">{tx("back")}</span>
            </button>
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="relative max-w-3xl mx-auto px-6 py-8">
        <p className="text-sm text-[var(--color-text-muted)] mb-6">
          {tx("subtitle")}
        </p>

        <section className="glass-card p-5 mb-4" aria-label={tx("methodTitle")}>
          <h2 className="text-base font-medium text-[var(--color-text)] mb-3">
            {tx("methodTitle")}
          </h2>
          <div className="grid gap-2" role="radiogroup">
            {methods.map((m) => (
              <label
                key={m.id}
                className={`flex gap-3 items-start rounded-lg border p-3 cursor-pointer ${
                  method === m.id
                    ? "border-[var(--color-electric)] bg-[var(--color-electric)]/5"
                    : "border-[var(--color-border)]"
                }`}
              >
                <input
                  type="radio"
                  name="fw-method"
                  className="mt-1"
                  checked={method === m.id}
                  disabled={running}
                  onChange={() => changeMethod(m.id)}
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                    {m.icon}
                    {tx(m.label)}
                  </span>
                  <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                    {tx(m.desc)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {method === "ble" && (
            <div className="mt-3">
              <Notice>{tx("bleBlockedNote")}</Notice>
            </div>
          )}
        </section>

        <Step title={tx("step1")} active>
          <p>{method === "serial" ? tx("step1Serial") : tx("step1Ota")}</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {tx("step1KeyHint")}
          </p>
        </Step>

        <Step title={tx("step2")} active>
          <p>{tx("step2Desc")}</p>
          <label className="btn-ghost border border-[var(--color-border)] inline-flex items-center gap-2 text-sm cursor-pointer">
            <IconFileUpload size={18} />
            {tx("chooseFile")}
            <input
              type="file"
              accept=".uf2,.zip"
              className="hidden"
              data-testid="fw-file-input"
              disabled={running}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          {candidates.length > 1 && (
            <label className="block">
              <span className="block text-xs mb-1">{tx("pickUf2")}</span>
              <select
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm text-[var(--color-text)]"
                value={selectedPath}
                disabled={running}
                onChange={(e) =>
                  void selectCandidate(candidates, e.target.value)
                }
              >
                {candidates.map((c) => (
                  <option key={c.path} value={c.path}>
                    {c.path}
                  </option>
                ))}
              </select>
            </label>
          )}
          {fileError && <Notice>{fileError}</Notice>}
          {firmware && (
            <div className="space-y-2">
              <p
                className="font-mono text-xs text-[var(--color-text)]"
                data-testid="fw-info"
              >
                {firmware.name}:{" "}
                {tx("fileInfo", {
                  size: firmware.image.binary.length,
                  start: hex(firmware.image.startAddress),
                  end: hex(firmware.image.endAddress),
                  crc: hex(firmware.crc16).padStart(4, "0"),
                })}
              </p>
              {firmware.half && (
                <p className="text-xs">
                  {tx("halfHint", { half: tx(firmware.half) })}
                </p>
              )}
              {firmware.warnings.includes("settings-reset") && (
                <Notice>{tx("warnSettingsReset")}</Notice>
              )}
              {firmware.warnings.includes("no-update-behavior") && (
                <Notice>{tx("warnNoUpdateBehavior")}</Notice>
              )}
              {needsAck && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  {tx("acknowledge")}
                </label>
              )}
            </div>
          )}
        </Step>

        {method === "phone" ? (
          <>
            <Step title={tx("phoneStep3")} active={fileReady}>
              <button
                className="btn-electric inline-flex items-center gap-2 text-sm"
                disabled={!fileReady}
                onClick={() =>
                  firmware &&
                  downloadBytes(
                    firmware.name.replace(/\.uf2$/i, "") + "-dfu.zip",
                    buildDfuPackageZip(firmware),
                  )
                }
              >
                <IconDownload size={18} />
                {tx("phoneDownload")}
              </button>
            </Step>
            <Step title={tx("phoneStep4")} active={fileReady}>
              <p>{tx("phoneStep4Desc")}</p>
            </Step>
            <Step title={tx("step5")} active={fileReady}>
              <p>{tx("step5Desc")}</p>
            </Step>
          </>
        ) : (
          <>
            <Step title={tx("step3")} active={fileReady}>
              <p>{method === "serial" ? tx("step3Serial") : tx("step3Ble")}</p>
              {method === "serial" && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={showAllPorts}
                    onChange={(e) => setShowAllPorts(e.target.checked)}
                  />
                  {tx("showAllPorts")}
                </label>
              )}
              <button
                className="btn-ghost border border-[var(--color-border)] inline-flex items-center gap-2 text-sm"
                disabled={connecting || running}
                onClick={() => void connect()}
              >
                {method === "serial" ? (
                  <IconUsb size={18} />
                ) : (
                  <IconBluetooth size={18} />
                )}
                {method === "serial" ? tx("connectSerial") : tx("connectBle")}
              </button>
              {link && (
                <p className="text-xs text-[var(--color-text)] flex items-center gap-1">
                  <IconCheck size={14} /> {tx("connected", { name: link.name })}
                </p>
              )}
              {connectError && <Notice>{errorText(connectError)}</Notice>}
            </Step>

            <Step title={tx("step4")} active={fileReady && !!link}>
              <div className="flex gap-2">
                <button
                  className="btn-electric text-sm"
                  disabled={!fileReady || !link || running}
                  onClick={() => void start()}
                >
                  {tx("start")}
                </button>
                {running && (
                  <button
                    className="btn-ghost border border-[var(--color-border)] text-sm"
                    onClick={() => abortRef.current?.abort()}
                  >
                    {tx("cancel")}
                  </button>
                )}
              </div>
              {run.phase === "running" && (
                <div data-testid="fw-progress">
                  <div className="h-2 rounded bg-[var(--color-border)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-electric)] transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <p className="text-xs mt-1">
                    {tx(`stage_${run.progress.stage}` as FirmwareUpdateKey, {
                      percent: progressPercent,
                    })}
                  </p>
                </div>
              )}
              {run.phase === "error" && <Notice>{errorText(run.error)}</Notice>}
              {run.phase === "done" && (
                <Notice tone="info">
                  {tx("doneMessage")}
                  {method === "serial" && <> {tx("serialDoneNote")}</>}
                </Notice>
              )}
            </Step>

            <Step title={tx("step5")} active={run.phase === "done"}>
              <p>{tx("step5Desc")}</p>
            </Step>
          </>
        )}

        <section className="glass-card p-5 mb-4 text-sm text-[var(--color-text-secondary)] space-y-3">
          <h2 className="text-base font-medium text-[var(--color-text)]">
            {tx("recoveryTitle")}
          </h2>
          <p>{tx("recoveryBody")}</p>
          <h2 className="text-base font-medium text-[var(--color-text)]">
            {tx("bootloaderTitle")}
          </h2>
          <p>
            {tx("bootloaderBody")}{" "}
            <a
              className="underline text-[var(--color-electric)]"
              href="https://blog.meshcore.io/2026/04/06/otafix-bootloader"
              target="_blank"
              rel="noopener noreferrer"
            >
              OTAFIX
            </a>
          </p>
        </section>
      </main>
    </div>
  );
}
