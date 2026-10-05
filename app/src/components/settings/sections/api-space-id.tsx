import { useTranslation } from "react-i18next";
import { useOrgs } from "../../../hooks/queries/use-spaces";
import { connectOrgSlug } from "../../../lib/agent-connect-model";
import { useWorkspaceStore } from "../../../stores/workspaces";
import { CopyIdRow } from "../copy-id-row";

/**
 * The open space's ID, the value an API caller sends as `x-houston-org` (and
 * the `:org` segment of an A2A address). Keys belong to the person, not a
 * space, and no route a key can reach returns this slug, so the app is the
 * only place a developer can read it. `null` while `GET /v1/orgs` loads;
 * `failed` once that read failed (already reported by the adapter), so the
 * caller hides the row instead of promising an ID forever. Pass `enabled`
 * false off the public API: a host without it serves no `/v1/orgs`.
 */
export function useSpaceSlug(enabled = true): {
  slug: string | null;
  failed: boolean;
} {
  const workspace = useWorkspaceStore((s) => s.current);
  const { data: orgs, isError } = useOrgs(enabled);
  const slug = connectOrgSlug(workspace?.id, orgs);
  return { slug, failed: !slug && isError };
}

/**
 * The Space ID card above the key list. Rendered only inside the API-keys
 * section, which is already gated on `capabilities.apiKeys`.
 */
export function ApiSpaceId() {
  const { t } = useTranslation("settings");
  const workspace = useWorkspaceStore((s) => s.current);
  const { slug, failed } = useSpaceSlug();
  if (failed) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-line bg-card">
      <CopyIdRow
        label={t("apiKeys.spaceId.title")}
        value={slug}
        copyFailedTitle={t("apiKeys.spaceId.copyFailed")}
        reportKey="copy_space_id"
      />
      <p className="px-4 pb-3 text-xs text-ink-muted">
        {workspace
          ? t("apiKeys.spaceId.description", { space: workspace.name })
          : t("apiKeys.spaceId.descriptionNoName")}
      </p>
    </div>
  );
}
