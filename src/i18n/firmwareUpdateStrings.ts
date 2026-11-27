/**
 * Firmware update page strings (ja / en). Kept out of the big translations.ts
 * dictionary, like labStrings.ts. `{name}` placeholders are filled by
 * {@link fwText}.
 */
import type { Language } from "./translations";

export const firmwareUpdateStrings = {
  title: { ja: "ファームウェア更新", en: "Firmware update" },
  subtitle: {
    ja: "UF2 のドラッグ&ドロップ (USB マスストレージ) が使えない PC でも、ブラウザからキーボードのファームウェアを書き込みます。",
    en: "Flash keyboard firmware from the browser, even on PCs where UF2 drag-and-drop (USB mass storage) is blocked.",
  },
  back: { ja: "戻る", en: "Back" },
  openUpdater: { ja: "ファームウェア更新を開く", en: "Open firmware updater" },
  tabLabel: { ja: "ファームウェア", en: "Firmware" },
  launcherBody: {
    ja: "更新モードに入るとキーボードが再起動し、この画面との接続は切れます。更新は接続不要の専用画面で行います。",
    en: "Entering update mode reboots the keyboard and ends this connection, so updates run on a separate page that does not need a Studio connection.",
  },

  methodTitle: { ja: "更新方法", en: "Update method" },
  methodSerial: {
    ja: "USB シリアル (このブラウザ)",
    en: "USB serial (this browser)",
  },
  methodSerialDesc: {
    ja: "USB ケーブルで接続し、Web Serial でブートローダーのシリアル DFU に書き込みます。マスストレージは使いません。&ser_dfu (Serial Update Mode) キーを使います。",
    en: "Connect with a USB cable and flash through the bootloader's serial DFU over Web Serial. No mass storage is used. Uses the &ser_dfu (Serial Update Mode) key.",
  },
  methodPhone: {
    ja: "Bluetooth OTA (スマホアプリ)",
    en: "Bluetooth OTA (phone app)",
  },
  methodPhoneDesc: {
    ja: "DFU パッケージ (.zip) を作り、スマホの nRF Device Firmware Update / nRF Connect で無線書き込みします。&ota_dfu (OTA Update Mode) キーを使います。",
    en: "Build a DFU package (.zip) and flash it wirelessly with nRF Device Firmware Update / nRF Connect on a phone. Uses the &ota_dfu (OTA Update Mode) key.",
  },
  methodBle: {
    ja: "Bluetooth OTA (このブラウザ・実験的)",
    en: "Bluetooth OTA (this browser, experimental)",
  },
  methodBleDesc: {
    ja: "Web Bluetooth で直接書き込みます。ただし Chrome / Edge は旧 Nordic DFU サービス (00001530-…) を Web Bluetooth のブロックリストで禁止しているため、現状の Chrome では接続できません。",
    en: "Flash directly over Web Bluetooth. Note that Chrome / Edge block the legacy Nordic DFU service (00001530-…) in the Web Bluetooth blocklist, so this does not work in current Chrome.",
  },
  bleBlockedNote: {
    ja: "Chrome は旧 Nordic DFU サービスをセキュリティ上の理由 (署名検証のない更新を Web ページから行えないようにするため) でブロックしています。無線で更新したい場合は「スマホアプリ」を使ってください。",
    en: "Chrome blocks the legacy Nordic DFU service for security reasons (web pages must not push unsigned firmware). To update wirelessly, use the phone app method.",
  },

  step1: {
    ja: "1. 更新したいハーフを更新モードにする",
    en: "1. Put the half you want to update into update mode",
  },
  step1Serial: {
    ja: "そのハーフを USB で PC につなぎ、Serial Update Mode キー (&ser_dfu) を押します。キーは押したハーフ側で実行されます。3 秒以内に USB が認識されないとブートローダーは通常起動に戻ります。",
    en: "Connect that half to the PC over USB and press its Serial Update Mode key (&ser_dfu). The key acts on the half where it is pressed. If USB is not enumerated within 3 seconds the bootloader returns to the normal firmware.",
  },
  step1Ota: {
    ja: "OTA Update Mode キー (&ota_dfu) を押します。押したハーフが再起動し、「AdaDFU」という名前で Bluetooth アドバタイズを始めます (もう片方は通常動作のまま)。",
    en: 'Press the OTA Update Mode key (&ota_dfu). The half where you pressed it reboots and advertises over Bluetooth as "AdaDFU" (the other half keeps working).',
  },
  step1KeyHint: {
    ja: "キーがまだ無い場合は、キーマップタブで任意のキーに「OTA Update Mode」/「Serial Update Mode」を割り当ててください (ファームウェアに zmk-feature-ota-dfu が入っている必要があります)。",
    en: 'If no key is bound yet, assign "OTA Update Mode" / "Serial Update Mode" to a key in the Keymap tab (the firmware must include zmk-feature-ota-dfu).',
  },
  step2: {
    ja: "2. ファームウェアファイルを選ぶ",
    en: "2. Choose the firmware file",
  },
  step2Desc: {
    ja: ".uf2、または GitHub Actions の成果物 (.zip) を選んでください。zip の場合は中の .uf2 を選べます。",
    en: "Choose a .uf2, or the GitHub Actions artifact (.zip). For a zip, pick the .uf2 inside it.",
  },
  chooseFile: { ja: "ファイルを選択", en: "Choose file" },
  pickUf2: { ja: "書き込む .uf2", en: ".uf2 to flash" },
  fileInfo: {
    ja: "{size} バイト / 0x{start}–0x{end} / CRC16 0x{crc}",
    en: "{size} bytes / 0x{start}–0x{end} / CRC16 0x{crc}",
  },
  halfHint: {
    ja: "ファイル名から {half} 側用と推定しました。更新モードにしたハーフと一致しているか確認してください。",
    en: "The file name suggests the {half} half. Make sure it matches the half you put into update mode.",
  },
  left: { ja: "左", en: "left" },
  right: { ja: "右", en: "right" },
  warnSettingsReset: {
    ja: "settings_reset は BLE ペアリングや Studio で編集したキーマップなどの設定を消去するファームウェアです。ブートローダーや SoftDevice は書き換えないので書き込み自体は安全ですが、更新モードキーを持たないため、元に戻すには USB (UF2 またはシリアル) での書き込みが必要になります。",
    en: "settings_reset erases settings such as BLE bonds and the keymap edited in Studio. It does not touch the bootloader or SoftDevice, so flashing it is safe, but it has no update-mode key, so going back requires a USB flash (UF2 or serial).",
  },
  warnNoUpdateBehavior: {
    ja: "このファームウェアには更新モードのビヘイビア (otadfu / serdfu) が見つかりません。書き込むと、次回はキー操作で更新モードに入れなくなります (USB のダブルリセットが必要)。",
    en: "This firmware does not contain the update-mode behaviors (otadfu / serdfu). After flashing it you cannot enter update mode from a key next time (a USB double reset will be needed).",
  },
  acknowledge: {
    ja: "内容を理解したうえで書き込む",
    en: "I understand, flash it anyway",
  },

  step3: {
    ja: "3. 更新モードのデバイスに接続する",
    en: "3. Connect to the device in update mode",
  },
  step3Serial: {
    ja: "ブートローダーのシリアルポート (Seeed XIAO nRF52840 など) を選びます。キーボード通常時のポートとは別のポートです。",
    en: "Pick the bootloader's serial port (e.g. Seeed XIAO nRF52840). It is a different port from the one the keyboard uses normally.",
  },
  step3Ble: { ja: "「AdaDFU」を選びます。", en: 'Pick "AdaDFU".' },
  showAllPorts: {
    ja: "すべてのシリアルポートを表示",
    en: "Show all serial ports",
  },
  connectSerial: { ja: "シリアルポートを選択", en: "Select serial port" },
  connectBle: { ja: "AdaDFU に接続", en: "Connect to AdaDFU" },
  connected: { ja: "接続済み: {name}", en: "Connected: {name}" },

  step4: { ja: "4. 書き込む", en: "4. Flash" },
  start: { ja: "書き込み開始", en: "Start update" },
  cancel: { ja: "キャンセル", en: "Cancel" },
  stage_connecting: { ja: "接続中…", en: "Connecting…" },
  stage_starting: { ja: "開始中…", en: "Starting…" },
  stage_erasing: {
    ja: "旧ファームウェアを消去中…",
    en: "Erasing the old firmware…",
  },
  stage_init: { ja: "検証情報を送信中…", en: "Sending the init packet…" },
  stage_uploading: { ja: "書き込み中… {percent}%", en: "Writing… {percent}%" },
  stage_validating: { ja: "検証中…", en: "Validating…" },
  stage_activating: {
    ja: "新しいファームウェアを有効化中…",
    en: "Activating the new firmware…",
  },
  stage_done: { ja: "完了", en: "Done" },

  step5: { ja: "5. 再起動を待つ", en: "5. Wait for the reboot" },
  step5Desc: {
    ja: "書き込みが終わるとキーボードは自動で再起動し、新しいファームウェアで起動します。セントラル側を更新した場合は、DYA Studio で再接続してください。",
    en: "When flashing finishes the keyboard reboots into the new firmware by itself. If you updated the central half, reconnect DYA Studio.",
  },
  doneMessage: {
    ja: "書き込みが完了しました。キーボードが再起動するまで数秒待ってください。",
    en: "Flashing finished. Wait a few seconds for the keyboard to reboot.",
  },
  serialDoneNote: {
    ja: "シリアル DFU ではブートローダーから最終結果が返らないため、再起動後にキーボードが動作することを確認してください。",
    en: "Serial DFU does not report a final result, so check that the keyboard works after it reboots.",
  },

  phoneStep3: { ja: "3. DFU パッケージを作る", en: "3. Build the DFU package" },
  phoneDownload: {
    ja: "DFU パッケージ (.zip) をダウンロード",
    en: "Download DFU package (.zip)",
  },
  phoneStep4: { ja: "4. スマホで書き込む", en: "4. Flash from the phone" },
  phoneStep4Desc: {
    ja: "zip をスマホに送り、nRF Device Firmware Update (または nRF Connect の DFU) で開き、「AdaDFU」を選んで開始します。パケット受信通知 (PRN) は有効のまま (例: 10)、必要なら「Legacy DFU」モードを選んでください。",
    en: 'Send the zip to your phone, open it in nRF Device Firmware Update (or nRF Connect\'s DFU), pick "AdaDFU" and start. Keep packet receipt notifications enabled (e.g. 10) and select legacy DFU if asked.',
  },

  recoveryTitle: { ja: "途中で失敗したら", en: "If an update fails midway" },
  recoveryBody: {
    ja: "ブートローダーは書き込み開始時に旧ファームウェアを消去します。失敗してもブートローダーは更新モードのまま待機しているので、電源を切らずにそのままやり直してください (Bluetooth は切断後に再アドバタイズします)。電源を切ったりリセットした場合は、ブートローダーが USB 更新モード (UF2 + シリアル) で起動するので、USB シリアルで書き込み直してください。ブートローダーや SoftDevice は書き換えないため、文鎮化はしません。",
    en: "The bootloader erases the old firmware when the transfer starts. If an update fails, the bootloader stays in update mode, so retry right away without powering off (over Bluetooth it re-advertises after a disconnect). If it is reset or loses power, it starts in USB update mode (UF2 + serial); flash again over USB serial. The bootloader and SoftDevice are never touched, so the board cannot be bricked.",
  },
  bootloaderTitle: { ja: "ブートローダーについて", en: "About the bootloader" },
  bootloaderBody: {
    ja: "XIAO nRF52840 の出荷時ブートローダー (0.6.x) は BLE OTA が不安定なことがあります。無線更新が途中で止まる場合は、修正版の OTAFIX ブートローダー (update-*.uf2) を一度だけ USB で書き込むことを検討してください (UF2 なので会社 PC 以外で実施)。",
    en: "The stock XIAO nRF52840 bootloader (0.6.x) can be unreliable for BLE OTA. If wireless updates stall, consider installing the OTAFIX bootloader (update-*.uf2) once over USB (UF2, so do it on a PC that allows mass storage).",
  },

  err_aborted: {
    ja: "キャンセルしました。ブートローダーは更新モードのままなので、やり直せます。",
    en: "Cancelled. The bootloader is still in update mode, so you can try again.",
  },
  err_disconnected: {
    ja: "更新中に接続が切れました。電源を切らずに、接続からやり直してください。",
    en: "The connection dropped during the update. Do not power off; reconnect and try again.",
  },
  err_timeout: {
    ja: "ブートローダーから応答がありません。更新モードになっているか、正しいデバイスを選んだか確認してやり直してください。",
    en: "The bootloader did not respond. Check that the half is in update mode and the right device was chosen, then retry.",
  },
  "err_remote-error": {
    ja: "ブートローダーがエラーを返しました: {detail}",
    en: "The bootloader reported an error: {detail}",
  },
  err_protocol: { ja: "通信エラー: {detail}", en: "Protocol error: {detail}" },
  err_transport: {
    ja: "通信エラー: {detail}",
    en: "Transport error: {detail}",
  },
  err_blocked: {
    ja: "ブラウザがアクセスを拒否しました ({detail})。Chrome は旧 Nordic DFU サービスをブロックしているため、USB シリアルかスマホアプリを使ってください。",
    en: "The browser refused access ({detail}). Chrome blocks the legacy Nordic DFU service; use USB serial or the phone app instead.",
  },
  err_unsupported: {
    ja: "このブラウザは必要な機能に対応していません。PC 版 Chrome / Edge を使ってください。",
    en: "This browser lacks the required API. Use desktop Chrome or Edge.",
  },
  "err_no-device": {
    ja: "デバイスが選択されませんでした。",
    en: "No device was selected.",
  },
  errFile: {
    ja: "ファイルを読み込めません: {detail}",
    en: "Cannot use this file: {detail}",
  },
} as const;

export type FirmwareUpdateKey = keyof typeof firmwareUpdateStrings;

export function fwText(
  language: Language,
  key: FirmwareUpdateKey,
  params?: Record<string, string | number>,
): string {
  const entry = firmwareUpdateStrings[key];
  let text: string = language === "ja" ? entry.ja : entry.en;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}
