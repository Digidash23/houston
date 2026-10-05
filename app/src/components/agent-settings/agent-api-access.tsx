import { BookOpen, Bot, Building2, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCapabilities } from "../../hooks/use-capabilities";
import { DEVELOPER_DOCS } from "../../lib/agent-connect-model";
import { apiKeysSupported } from "../../lib/api-keys-model";
import { tauriSystem } from "../../lib/tauri";
import type { Agent } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import { CopyIdRow } from "../settings/copy-id-row";
import { useSpaceSlug } from "../settings/sections/api-space-id";
import { SettingsCard, SettingsRow } from "../settings/settings-row";

/**
 * "API access" on an AI Employee's Settings: the two IDs a developer needs to
 * reach THIS employee from their own code, plus the doors to the person's keys
 * (Settings > API keys) and the developer docs. Shown only where the
 * deployment serves the public API. On the hosted gateway the agent's
 * client-side id IS its public slug (`agent-connect-model.ts`).
 */
export function AgentApiAccess({ agent }: { agent: Agent }) {
  const { t } = useTranslation("settings");
  const { capabilities } = useCapabilities();
  const supported = apiKeysSupported(capabilities);
  const { slug, failed } = useSpaceSlug(supported);
  if (!supported) return null;

  return (
    <div className="mt-8">
      <SettingsCard title={t("apiKeys.agentAccess.title")}>
        <CopyIdRow
          icon={Bot}
          label={t("apiKeys.agentAccess.agentId")}
          value={agent.id}
          copyFailedTitle={t("apiKeys.agentAccess.agentIdCopyFailed")}
          reportKey="copy_agent_id"
        />
        {!failed && (
          <CopyIdRow
            icon={Building2}
            label={t("apiKeys.spaceId.title")}
            value={slug}
            copyFailedTitle={t("apiKeys.spaceId.copyFailed")}
            reportKey="copy_space_id"
          />
        )}
        <SettingsRow
          icon={KeyRound}
          title={t("apiKeys.agentAccess.keysRow")}
          description={t("apiKeys.agentAccess.keysRowDescription", {
            name: agent.name,
          })}
          onClick={() => useUIStore.getState().openSettings("apiKeys")}
        />
        <SettingsRow
          icon={BookOpen}
          title={t("apiKeys.agentAccess.docsRow")}
          description={t("apiKeys.agentAccess.docsRowDescription", {
            name: agent.name,
          })}
          chevron={false}
          onClick={() => void tauriSystem.openUrl(DEVELOPER_DOCS.overview)}
        />
      </SettingsCard>
    </div>
  );
}
