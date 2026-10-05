import { Button } from "@houston-ai/core";
import { Check, Copy, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { genericErrorDescription } from "../../lib/error-report";
import { useUIStore } from "../../stores/ui";

interface CopyIdRowProps {
  label: string;
  /** `null` while the value is still loading. */
  value: string | null;
  icon?: LucideIcon;
  /** Toast title when the clipboard refuses the write. */
  copyFailedTitle: string;
  /** The `genericErrorDescription` key the failure reports under. */
  reportKey: string;
}

/**
 * One identifier a developer pastes into their own code (an agent's slug, a
 * space's ID): the label, the value in mono, and a Copy button. "Copied"
 * belongs to the value it copied, so a different value reads fresh.
 */
export function CopyIdRow({
  label,
  value,
  icon: Icon,
  copyFailedTitle,
  reportKey,
}: CopyIdRowProps) {
  const { t } = useTranslation("settings");
  const addToast = useUIStore((s) => s.addToast);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const copied = value !== null && copiedValue === value;

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      addToast({ title: t("apiKeys.idRow.copied") });
    } catch (err) {
      addToast({
        title: copyFailedTitle,
        description: genericErrorDescription(reportKey, err),
        variant: "error",
      });
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {Icon && <Icon className="size-[18px] shrink-0 text-ink-muted" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{label}</div>
        <code className="mt-0.5 block truncate font-mono text-xs text-ink-muted">
          {value ?? t("apiKeys.idRow.loading")}
        </code>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        disabled={!value}
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t("apiKeys.idRow.copied") : t("apiKeys.idRow.copy")}
      </Button>
    </div>
  );
}
