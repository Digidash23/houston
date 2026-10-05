import { BookOpen, Bot, Building2, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEVELOPER_DOCS } from "../../lib/agent-connect-model";
import { tauriSystem } from "../../lib/tauri";
import type { Agent } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import { CopyIdRow } from "../settings/copy-id-row";
import { useOrgSlug } from "../settings/sections/api-org-id";
import { SettingsCard, SettingsRow } from "../settings/settings-row";
import { BackControl } from "../shell/back-control";

/**
 * "API access", one level below an AI Employee's Settings: the two IDs a
 * developer needs to reach THIS employee from their own code, plus the doors
 * to the person's keys (Settings > API keys) and the developer docs. Its row
 * on the Settings card is gated on `capabilities.apiKeys`, so this screen only
 * mounts where the deployment serves the public API. On the hosted gateway the
 * agent's client-side id IS its public slug (`agent-connect-model.ts`).
 */
export function AgentApiAccess({
  agent,
  onBack,
}: {
  agent: Agent;
  onBack: () => void;
}) {
  const { t } = useTranslation(["settings", "teams"]);
  const { slug, failed } = useOrgSlug();

  return (
    <section>
      <BackControl
        label={t("teams:agentSettings.manage.sectionTitle")}
        onClick={onBack}
      />
      <h2 className="mt-4 text-lg font-semibold text-ink">
        {t("settings:apiKeys.agentAccess.title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-ink-muted">
        {t("settings:apiKeys.agentAccess.intro", { name: agent.name })}
      </p>
      <SettingsCard>
        <CopyIdRow
          icon={Bot}
          label={t("settings:apiKeys.agentAccess.agentId")}
          value={agent.id}
          copyFailedTitle={t("settings:apiKeys.agentAccess.agentIdCopyFailed")}
          reportKey="copy_agent_id"
        />
        {!failed && (
          <CopyIdRow
            icon={Building2}
            label={t("settings:apiKeys.orgId.title")}
            value={slug}
            copyFailedTitle={t("settings:apiKeys.orgId.copyFailed")}
            reportKey="copy_org_id"
          />
        )}
        <SettingsRow
          icon={KeyRound}
          title={t("settings:apiKeys.agentAccess.keysRow")}
          description={t("settings:apiKeys.agentAccess.keysRowDescription", {
            name: agent.name,
          })}
          onClick={() => useUIStore.getState().openSettings("apiKeys")}
        />
        <SettingsRow
          icon={BookOpen}
          title={t("settings:apiKeys.agentAccess.docsRow")}
          description={t("settings:apiKeys.agentAccess.docsRowDescription", {
            name: agent.name,
          })}
          chevron={false}
          onClick={() => void tauriSystem.openUrl(DEVELOPER_DOCS.overview)}
        />
      </SettingsCard>
    </section>
  );
}
