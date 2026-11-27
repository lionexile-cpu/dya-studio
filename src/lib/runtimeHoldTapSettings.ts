// Display metadata for the zmk-feature-runtime-holdtap module's custom
// settings (https://github.com/lionexile-cpu/zmk-feature-runtime-holdtap).
//
// The firmware registers one set of settings per hold-tap behavior instance in
// the "rt_holdtap" custom subsystem. Keys are "<field>@<label>", where label is
// the behavior's runtime-settings-label / display-name / node name
// (e.g. "flavor@Layer-Tap", "tapping_term_ms@Alpha Mod-Tap"). The Advanced
// Settings section groups the rows by label so each hold-tap gets its own
// block, shows a readable field name instead of the raw key, and explains each
// field and flavor option in English / Japanese.

export const RUNTIME_HOLD_TAP_IDENTIFIER = "rt_holdtap";

export interface BilingualText {
  en: string;
  ja: string;
}

export interface RuntimeHoldTapField {
  // Field part of the setting key ("<field>@<label>").
  field: string;
  // Devicetree property the field mirrors (shown as a hint).
  property: string;
  label: BilingualText;
  description: BilingualText;
}

// Display order inside one hold-tap group.
export const RUNTIME_HOLD_TAP_FIELDS: RuntimeHoldTapField[] = [
  {
    field: "flavor",
    property: "flavor",
    label: { en: "Flavor", ja: "判定方式 (flavor)" },
    description: {
      en: "How a press is decided as tap or hold when another key is involved. hold-preferred: hold as soon as another key is pressed. balanced: hold when another key is pressed AND released while this key is still held. tap-preferred: only the tapping term makes a hold (other keys never do). tap-unless-interrupted: hold only when another key is pressed before the tapping term; otherwise tap.",
      ja: "他のキーが絡んだときにタップ/ホールドをどう判定するかです。hold-preferred: 他のキーを押した時点でホールド。balanced: このキーを押したまま他のキーを押して離したらホールド。tap-preferred: 押し続けて tapping term を超えたときだけホールド（他キーではホールドにならない）。tap-unless-interrupted: tapping term 内に他のキーを押したときだけホールド、それ以外はタップ。",
    },
  },
  {
    field: "tapping_term_ms",
    property: "tapping-term-ms",
    label: { en: "Tapping term (ms)", ja: "長押し判定時間 (ms)" },
    description: {
      en: "How long the key must be held before it becomes a hold. Shorter makes holds easier (and accidental holds more likely); longer makes taps safer.",
      ja: "この時間以上押し続けるとホールド（長押し）になります。短くすると長押ししやすく誤爆もしやすく、長くするとタップが安定します。",
    },
  },
  {
    field: "quick_tap_ms",
    property: "quick-tap-ms",
    label: { en: "Quick tap (ms)", ja: "連打判定時間 (ms)" },
    description: {
      en: "If this same key was tapped within this time, pressing it again is always a tap, so holding it auto-repeats the tap key. -1 disables.",
      ja: "同じキーをこの時間内に再度押すと必ずタップ扱いになり、押し続けるとタップ側のキーがリピートします。-1で無効です。",
    },
  },
  {
    field: "prior_idle_ms",
    property: "require-prior-idle-ms",
    label: { en: "Require prior idle (ms)", ja: "直前打鍵からの待ち (ms)" },
    description: {
      en: "If any other key was typed within this time before pressing this key, it is always a tap. Prevents accidental holds while typing fast. -1 disables.",
      ja: "このキーを押す直前、この時間内に他のキーを打っていたら必ずタップ扱いにします。速い打鍵中の誤爆を防ぎます。-1で無効です。",
    },
  },
  {
    field: "retro_tap",
    property: "retro-tap",
    label: { en: "Retro tap", ja: "リトロタップ" },
    description: {
      en: "If the key is held past the tapping term and released without pressing another key, send the tap key anyway.",
      ja: "tapping term を超えて押し続けても、他のキーを押さずに離した場合はタップ側のキーを送ります。",
    },
  },
  {
    field: "trigger_on_release",
    property: "hold-trigger-on-release",
    label: {
      en: "Hold trigger on release",
      ja: "ホールド位置判定を離したときに",
    },
    description: {
      en: "Evaluate the hold trigger key positions when the other key is released instead of when it is pressed (useful for combining several modifiers).",
      ja: "「ホールドを許可するキー位置」の判定を、他のキーを押したときではなく離したときに行います（複数の修飾キーを組み合わせるときに便利です）。",
    },
  },
  {
    field: "hold_while_undecided",
    property: "hold-while-undecided",
    label: { en: "Hold while undecided", ja: "判定中もホールドを押す" },
    description: {
      en: "Press the hold behavior immediately and keep it while undecided; it is released again if the press turns out to be a tap.",
      ja: "判定がつく前からホールド側の動作を押しておきます。タップと判定されたら離されます。",
    },
  },
  {
    field: "undecided_linger",
    property: "hold-while-undecided-linger",
    label: { en: "Linger after tap", ja: "タップ後もホールドを残す" },
    description: {
      en: "With 'hold while undecided', keep the hold behavior pressed until the key is released even if it was decided as a tap.",
      ja: "「判定中もホールドを押す」と併用し、タップと判定されてもキーを離すまでホールド側の動作を押したままにします。",
    },
  },
  {
    field: "trigger_positions",
    property: "hold-trigger-key-positions",
    label: {
      en: "Hold trigger key positions",
      ja: "ホールドを許可するキー位置",
    },
    description: {
      en: 'Key positions (keymap key numbers) that may turn this key into a hold. If the first other key pressed is not listed, the press becomes a tap. Comma separated, ranges allowed, e.g. "5-9, 15-19, 32". Empty disables.',
      ja: 'このキーをホールドにしてよい「他のキー」の位置（キーマップ上のキー番号）です。最初に押した他のキーがここに無ければタップになります。カンマ区切りで範囲指定も可（例: "5-9, 15-19, 32"）。空欄で無効です。',
    },
  },
  {
    field: "ignore_positions",
    property: "ignore-key-positions",
    label: { en: "Ignored key positions", ja: "判定に使わないキー位置" },
    description: {
      en: "Key positions that are ignored by this hold-tap's decision (they pass through as if no hold-tap were pending). Same format as above.",
      ja: "このホールドタップの判定で無視するキー位置です（判定待ちでもそのまま入力されます）。書式は上と同じです。",
    },
  },
];

const FIELD_BY_NAME = new Map(
  RUNTIME_HOLD_TAP_FIELDS.map((field) => [field.field, field]),
);

export const RUNTIME_HOLD_TAP_SECTION_TITLE: BilingualText = {
  en: "Hold-Tap (runtime)",
  ja: "ホールドタップ（実行時設定）",
};

export const RUNTIME_HOLD_TAP_SECTION_DESCRIPTION: BilingualText = {
  en: "Tap/hold timing and decision rules of each hold-tap behavior (Layer-Tap, Mod-Tap, ...). Changes apply immediately; Save keeps them across reboots and Reset restores the firmware defaults.",
  ja: "各ホールドタップ（Layer-Tap・Mod-Tap など）のタップ/長押しの判定方式と時間の設定です。変更は即座に反映され、「保存」で再起動後も保持、「リセット」でファームウェアの既定値に戻ります。",
};

// Explanatory labels for the flavor options reported by the firmware.
const FLAVOR_OPTION_LABELS: Record<string, BilingualText> = {
  "hold-preferred": {
    en: "hold-preferred (hold on other key press)",
    ja: "hold-preferred（他キー押下でホールド）",
  },
  balanced: {
    en: "balanced (hold on other key press + release)",
    ja: "balanced（他キーを押して離したらホールド）",
  },
  "tap-preferred": {
    en: "tap-preferred (hold only by time)",
    ja: "tap-preferred（時間経過のみでホールド）",
  },
  "tap-unless-interrupted": {
    en: "tap-unless-interrupted (hold only on other key press)",
    ja: "tap-unless-interrupted（他キー押下時のみホールド）",
  },
};

export function pickRuntimeHoldTapText(
  text: BilingualText,
  language: string,
): string {
  return language === "ja" ? text.ja : text.en;
}

export interface RuntimeHoldTapKey {
  field: string;
  instance: string;
}

// Split "<field>@<label>" (the label may itself contain spaces or '@').
export function parseRuntimeHoldTapKey(key: string): RuntimeHoldTapKey {
  const at = key.indexOf("@");
  if (at === -1) return { field: key, instance: "" };
  return { field: key.slice(0, at), instance: key.slice(at + 1) };
}

export function runtimeHoldTapField(
  field: string,
): RuntimeHoldTapField | undefined {
  return FIELD_BY_NAME.get(field);
}

export function runtimeHoldTapFlavorOptionLabel(
  firmwareLabel: string,
  language: string,
): string {
  const text = FLAVOR_OPTION_LABELS[firmwareLabel];
  return text ? pickRuntimeHoldTapText(text, language) : firmwareLabel;
}

function fieldOrder(field: string): number {
  const index = RUNTIME_HOLD_TAP_FIELDS.findIndex(
    (entry) => entry.field === field,
  );
  return index === -1 ? RUNTIME_HOLD_TAP_FIELDS.length : index;
}

export interface RuntimeHoldTapGroup<T> {
  instance: string;
  settings: T[];
}

// Group settings by hold-tap instance (key suffix), keeping the instances in
// first-seen order and the fields in RUNTIME_HOLD_TAP_FIELDS order (unknown
// fields last, by key).
export function groupRuntimeHoldTapSettings<T extends { key: string }>(
  settings: T[],
): RuntimeHoldTapGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const setting of settings) {
    const { instance } = parseRuntimeHoldTapKey(setting.key);
    const list = groups.get(instance);
    if (list) {
      list.push(setting);
    } else {
      groups.set(instance, [setting]);
    }
  }
  return Array.from(groups.entries()).map(([instance, list]) => ({
    instance,
    settings: [...list].sort((a, b) => {
      const fa = parseRuntimeHoldTapKey(a.key).field;
      const fb = parseRuntimeHoldTapKey(b.key).field;
      return fieldOrder(fa) - fieldOrder(fb) || fa.localeCompare(fb);
    }),
  }));
}
