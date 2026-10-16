import { PREFERENCES_NAMESPACE } from "@houston/domain";
import { AGENT_STORE_MIGRATION_PATHS } from "@houston/host/src/migrate/agent-store";
import { agentRouteScope, type OpInclude } from "./op-scope";

/** The pre-custody plaintext custom-integration secrets, at the store root
 *  beside `custom-integrations.json` (host-integrations.ts). */
export const LEGACY_SECRETS_FILE = "custom-integration-secrets.json";

/** The workspace preferences documents, beside the agent's folder. */
export const PREFERENCES_PREFIX = `workspaces/${PREFERENCES_NAMESPACE}/`;

/**
 * What the boot migrations read: the agent files they name
 * (AGENT_STORE_MIGRATION_PATHS), the workspace preferences and the legacy
 * secrets file. User files, skills, chats, sessions, the runtime and
 * anything an agent keeps under `.houston/` (backup tarballs) stay in the
 * store, so a big agent migrates for the cost of its small files.
 */
export function migrateHydrateFilter(rel: string): boolean {
  if (rel === LEGACY_SECRETS_FILE || rel.startsWith(PREFERENCES_PREFIX))
    return true;
  const parts = rel.split("/");
  if (parts[0] !== "workspaces" || parts.length < 4) return false;
  return AGENT_STORE_MIGRATION_PATHS.has(parts.slice(3).join("/"));
}

/**
 * What the migration may write back: the agent's tree as any agent op may
 * (never its runtime), the workspace preferences the sidebar and GROUP.md
 * steps keep their markers in, and the removal of the legacy secrets file.
 */
export function migrateScope(workspaceRel: string): OpInclude {
  const agent = agentRouteScope(workspaceRel);
  return (rel) =>
    agent(rel) ||
    rel.startsWith(PREFERENCES_PREFIX) ||
    rel === LEGACY_SECRETS_FILE;
}
