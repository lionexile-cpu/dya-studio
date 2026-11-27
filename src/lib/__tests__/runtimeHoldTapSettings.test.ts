import {
  RUNTIME_HOLD_TAP_FIELDS,
  groupRuntimeHoldTapSettings,
  parseRuntimeHoldTapKey,
  runtimeHoldTapField,
  runtimeHoldTapFlavorOptionLabel,
} from "../runtimeHoldTapSettings";

describe("runtimeHoldTapSettings", () => {
  it("splits keys into field and hold-tap label", () => {
    expect(parseRuntimeHoldTapKey("tapping_term_ms@Alpha Layer-Tap")).toEqual({
      field: "tapping_term_ms",
      instance: "Alpha Layer-Tap",
    });
    expect(parseRuntimeHoldTapKey("flavor")).toEqual({
      field: "flavor",
      instance: "",
    });
  });

  it("groups settings per hold-tap in field order", () => {
    const settings = [
      { key: "quick_tap_ms@Layer-Tap" },
      { key: "flavor@Mod-Tap" },
      { key: "flavor@Layer-Tap" },
      { key: "unknown_field@Layer-Tap" },
      { key: "tapping_term_ms@Layer-Tap" },
    ];
    const groups = groupRuntimeHoldTapSettings(settings);
    expect(groups.map((group) => group.instance)).toEqual([
      "Layer-Tap",
      "Mod-Tap",
    ]);
    expect(groups[0].settings.map((setting) => setting.key)).toEqual([
      "flavor@Layer-Tap",
      "tapping_term_ms@Layer-Tap",
      "quick_tap_ms@Layer-Tap",
      "unknown_field@Layer-Tap",
    ]);
  });

  it("describes every field the firmware registers", () => {
    const firmwareFields = [
      "flavor",
      "tapping_term_ms",
      "quick_tap_ms",
      "prior_idle_ms",
      "retro_tap",
      "trigger_on_release",
      "hold_while_undecided",
      "undecided_linger",
      "trigger_positions",
      "ignore_positions",
    ];
    expect(RUNTIME_HOLD_TAP_FIELDS.map((entry) => entry.field)).toEqual(
      firmwareFields,
    );
    for (const field of firmwareFields) {
      const entry = runtimeHoldTapField(field);
      expect(entry?.label.ja).toBeTruthy();
      expect(entry?.description.en).toBeTruthy();
    }
  });

  it("localizes flavor options and passes unknown labels through", () => {
    expect(runtimeHoldTapFlavorOptionLabel("balanced", "ja")).toContain(
      "balanced",
    );
    expect(runtimeHoldTapFlavorOptionLabel("balanced", "ja")).not.toEqual(
      "balanced",
    );
    expect(runtimeHoldTapFlavorOptionLabel("something-else", "en")).toEqual(
      "something-else",
    );
  });
});
