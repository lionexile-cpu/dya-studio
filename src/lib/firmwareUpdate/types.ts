/** Shared types for the legacy DFU drivers. */

export type DfuStage =
  | "connecting"
  | "starting"
  | "erasing"
  | "init"
  | "uploading"
  | "validating"
  | "activating"
  | "done";

export interface DfuProgress {
  stage: DfuStage;
  bytesSent: number;
  totalBytes: number;
}

export type DfuErrorCode =
  | "aborted"
  | "disconnected"
  | "timeout"
  | "remote-error"
  | "protocol"
  | "transport"
  /** The browser refused access (e.g. the Web Bluetooth GATT blocklist). */
  | "blocked"
  /** The browser lacks the required API (Web Serial / Web Bluetooth). */
  | "unsupported"
  /** The user closed the device chooser without picking a device. */
  | "no-device";

export class DfuError extends Error {
  readonly code: DfuErrorCode;
  /** Legacy DFU response status (BLE) when {@link code} is "remote-error". */
  readonly status?: number;
  readonly stage?: DfuStage;
  constructor(
    code: DfuErrorCode,
    message: string,
    opts: { status?: number; stage?: DfuStage; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "DfuError";
    this.code = code;
    this.status = opts.status;
    this.stage = opts.stage;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

export interface DfuImage {
  binary: Uint8Array;
  initPacket: Uint8Array;
}

export interface DfuRunOptions {
  signal?: AbortSignal;
  onProgress?: (p: DfuProgress) => void;
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  stage?: DfuStage,
) {
  if (signal?.aborted) {
    throw new DfuError("aborted", "The update was cancelled.", { stage });
  }
}

/** Sleep that rejects with an "aborted" DfuError when the signal fires. */
export function abortableSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DfuError("aborted", "The update was cancelled."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DfuError("aborted", "The update was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
