import { IconCpu, IconExternalLink } from "@tabler/icons-react";
import { useLanguage } from "../hooks/useLanguage";
import { fwText } from "../i18n/firmwareUpdateStrings";
import { FIRMWARE_UPDATE_PATH } from "../lib/firmwareUpdate/routes";

/**
 * Firmware tab content: an entry point to the standalone /firmware-update
 * page. The update itself cannot live inside the tab, because putting the
 * keyboard into update mode reboots it and drops the Studio connection,
 * which unmounts every tab.
 */
export function FirmwareUpdateLauncher() {
  const { language } = useLanguage();
  const open = () => {
    window.history.pushState(null, "", FIRMWARE_UPDATE_PATH);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="glass-card p-6 space-y-4">
          <h2 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
            <IconCpu size={20} className="text-[var(--color-electric)]" />
            {fwText(language, "title")}
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {fwText(language, "subtitle")}
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {fwText(language, "launcherBody")}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {fwText(language, "step1KeyHint")}
          </p>
          <button
            className="btn-electric inline-flex items-center gap-2 text-sm"
            onClick={open}
          >
            <IconExternalLink size={18} />
            {fwText(language, "openUpdater")}
          </button>
        </div>
      </div>
    </div>
  );
}
