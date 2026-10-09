import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@houston-ai/core";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { analytics } from "../../../lib/analytics";
import {
  changeLocale,
  isSupported,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "../../../lib/i18n";
import { tellOptimisticRefusal } from "../../../lib/optimistic-write";
import { useUIStore } from "../../../stores/ui";
import { useWorkspaceStore } from "../../../stores/workspaces";
import { SettingsControlRow } from "../settings-row";

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
};

export function LanguageSection() {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const addToast = useUIStore((s) => s.addToast);
  const current = useWorkspaceStore((s) => s.current);
  const setWorkspaceLocale = useWorkspaceStore((s) => s.setLocale);
  const currentLocale: SupportedLocale = isSupported(i18n.resolvedLanguage)
    ? (i18n.resolvedLanguage as SupportedLocale)
    : "en";

  const handleLocaleChange = async (value: string) => {
    // The language switches at once and the override saves behind it. A
    // refusal puts the workspace's old locale back, which the locale gate
    // (`use-locale-preference.ts`) re-applies, and says the change did not
    // stick. `current` is guaranteed once a workspace is active; the guard
    // just defends the rare unmount race.
    if (!isSupported(value) || !current) return;
    const previous = currentLocale;
    // Observed now, so the switch below can never leave it unhandled.
    const saved = setWorkspaceLocale(current.id, value).then(
      () => null,
      (err: unknown) => ({ err }),
    );
    await changeLocale(value);
    analytics.track("language_changed", { locale: value });
    addToast({ title: t("common:language.toastChanged") });
    const refused = await saved;
    if (!refused) return;
    // The gate re-applies only a workspace or global choice; a workspace with
    // neither still needs the language it showed put back.
    await changeLocale(previous);
    tellOptimisticRefusal("set_workspace_locale", refused.err, {
      title: t("settings:writeFailed.language.title"),
      description: t("settings:writeFailed.language.description"),
    });
  };

  return (
    <SettingsControlRow icon={Languages} title={t("settings:nav.language")}>
      <Select value={currentLocale} onValueChange={handleLocaleChange}>
        <SelectTrigger
          aria-label={t("settings:nav.language")}
          className="w-40 rounded-lg"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LOCALES.map((loc) => (
            <SelectItem key={loc} value={loc}>
              {LOCALE_LABELS[loc]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsControlRow>
  );
}
