import { relative, sep } from "node:path";
import type { Agent, WorkspaceId } from "../domain/types";
import { LocalPaths } from "../paths";
import { LocalWorkspaceStore } from "../store/local";
import { FsVfs } from "../vfs";
import { migrateAgentLayout } from "./agent-layout";
import { reseedAgentSchema } from "./agent-schemas";
import { sweepGatewayGroupNotes } from "./gateway-group-notes";
import { sweepAgentLegacySetup } from "./legacy-setup-directive";
import { backfillAgentRoutineCreatedBy } from "./routine-created-by";
import { migrateSidebarLayout } from "./sidebar-layout";

/**
 * The host's boot migrations (local/host-migrations.ts) for ONE agent's
 * hydrated store tree: what a managed pod's boot did to the agent it served,
 * run by a pool worker's `migrate` op where no pod boots any more.
 *
 * Bump AGENT_STORE_MIGRATION_VERSION whenever a migration is added here or
 * changes what it writes: the gateway records the version each agent's store
 * reached and runs the op again for every agent behind it. Cloud mirrors the
 * number as pooldispatch.StoreMigrationVersion.
 */
export const AGENT_STORE_MIGRATION_VERSION = 1;

/** The `../migrate/*` modules this runner covers (agent-store.test.ts holds
 *  host-migrations.ts to it, so a new boot migration cannot skip the op). */
export const AGENT_STORE_MIGRATIONS = [
  "agent-layout",
  "agent-schemas",
  "gateway-group-notes",
  "legacy-setup-directive",
  "routine-created-by",
  "sidebar-layout",
] as const;

/** Boot migrations that never apply to a managed agent's store, and why. */
export const HOST_ONLY_MIGRATIONS: Record<string, string> = {
  "chat-history":
    "imports the Rust-era desktop SQLite db, which no managed store holds",
};

export interface AgentStoreMigrationReport {
  /** Flat pre-v0.4 files copied into their family folders. */
  layoutFiles: number;
  /** Family schemas rewritten to this build's. */
  schemaFiles: number;
  /** CLAUDE.md files that lost the retired onboarding section. */
  setupSections: number;
  /** Routines that gained the org owner as their creator. */
  routinesStamped: number;
}

/**
 * Migrate one agent, in the order a pod's boot runs the same steps. The
 * per-agent steps throw on any failure (the caller must not record the
 * version), except a routines doc that is not JSON: the boot leaves that one
 * to the read path's diagnostics, and so does this. The workspace-level steps
 * (sidebar layout, gateway GROUP.md notes) keep their boot posture: logged,
 * retried by their own markers.
 */
export async function migrateAgentStore(opts: {
  /** The hydrated `workspaces/` directory. */
  workspacesRoot: string;
  /** The agent's directory under it. */
  agentRoot: string;
  /** The org owner's user id, stamped on routines that name no creator. */
  ownerSub?: string;
  log: (message: string, error?: unknown) => void;
}): Promise<AgentStoreMigrationReport> {
  const { workspacesRoot, agentRoot, log } = opts;
  const store = new OneAgentStore(
    workspacesRoot,
    relative(workspacesRoot, agentRoot).split(sep).join("/"),
  );
  const vfs = new FsVfs(workspacesRoot);
  const paths = new LocalPaths();
  await migrateSidebarLayout({ store, vfs, paths, log });
  await sweepGatewayGroupNotes({ enginePod: true, store, vfs, paths, log });
  const lines = (line: string) => log(line);
  const report: AgentStoreMigrationReport = {
    layoutFiles: migrateAgentLayout(agentRoot, lines),
    schemaFiles: reseedAgentSchema(agentRoot, lines),
    setupSections: sweepAgentLegacySetup(agentRoot) ? 1 : 0,
    routinesStamped: 0,
  };
  if (opts.ownerSub) {
    try {
      report.routinesStamped = backfillAgentRoutineCreatedBy(
        agentRoot,
        opts.ownerSub,
      );
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      log(`[routine-created-by] ${agentRoot}: routines doc is not JSON`);
    }
  }
  return report;
}

/**
 * The local store with every other folder of the workspace hidden: a stray
 * folder beside the agent (no agent, just files) is not this migration's to
 * touch, and its writes would fall outside what the migrate op may sync.
 */
class OneAgentStore extends LocalWorkspaceStore {
  constructor(
    root: string,
    private readonly agentId: string,
  ) {
    super(root);
  }

  override async listAgents(workspaceId: WorkspaceId): Promise<Agent[]> {
    const agents = await super.listAgents(workspaceId);
    return agents.filter((agent) => agent.id === this.agentId);
  }

  override async listAllAgents(): Promise<Agent[]> {
    const agents = await super.listAllAgents();
    return agents.filter((agent) => agent.id === this.agentId);
  }
}
