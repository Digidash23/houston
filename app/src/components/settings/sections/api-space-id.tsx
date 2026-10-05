import { Button } from "@houston-ai/core";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrgs } from "../../../hooks/queries/use-spaces";
import { connectOrgSlug } from "../../../lib/agent-connect-model";
import { genericErrorDescription } from "../../../lib/error-report";
import { useUIStore } from "../../../stores/ui";
import { useWorkspaceStore } from "../../../stores/workspaces";

/**
 * The open space's ID, the value an API caller sends as `x-houston-org` (and
 * the `:org` segment of an A2A address). Keys belong to the person, not a
 * space, and no route a key can reach returns this slug, so this row is the
 * only place a developer can read it. Rendered only inside the API-keys
 * section, which is already gated on `capabilities.apiKeys`.
 */
export function ApiSpaceId() {
  const { t } = useTranslation("settings");
  const workspace = useWorkspaceStore((s) => s.current);
  const { data: orgs } = useOrgs(true);
  const addToast = useUIStore((s) => s.addToast);
  const [copied, setCopied] = useState(false);
  const slug = connectOrgSlug(workspace?.id, orgs);

  async function copySlug() {
    if (!slug) return;
    try {
      await navigator.clipboard.writeText(slug);
      setCopied(true);
      addToast({ title: t("apiKeys.spaceId.copied") });
    } catch (err) {
      addToast({
        title: t("apiKeys.spaceId.copyFailed"),
        description: genericErrorDescription("copy_space_id", err),
        variant: "error",
      });
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-line bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">
            {t("apiKeys.spaceId.title")}
          </div>
          <code className="mt-0.5 block truncate font-mono text-xs text-ink-muted">
            {slug ?? t("apiKeys.spaceId.loading")}
          </code>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={!slug}
          onClick={() => void copySlug()}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("apiKeys.spaceId.copied") : t("apiKeys.spaceId.copy")}
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {t("apiKeys.spaceId.description", { space: workspace?.name ?? "" })}
      </p>
    </div>
  );
}
