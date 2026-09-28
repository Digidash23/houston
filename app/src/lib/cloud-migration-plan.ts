/**
 * The desktop→cloud migration plan (HOU-719): which cloud name each legacy
 * agent migrates into, and which existing cloud agents a previous run could
 * have produced (resume). Pure, so `node --test` exercises it directly (see
 * `app/tests/cloud-migration.test.ts`).
 */

import { agentNameKey } from "@houston/sdk/agent-name";
import type { CreateAgent } from "@houston/wire-types";
import type { MigrationTask, SourceAgent } from "./cloud-migration";

/** The cloud agents are created as ordinary personal assistants. */
const MIGRATED_AGENT_CONFIG_ID = "personal-assistant";

/**
 * The cloud create a task's agent moves in with. `migration: true` keeps its
 * desktop name even when it is the AI Manager's "Houston", which a new
 * employee may not take. The legacy overlay color rides along: the adapter's
 * create routes `color` into the overlay keyed by the NEW agent id, and
 * undefined falls back to the default color, so this is the only seed point.
 */
export function migratedAgentCreate(task: MigrationTask): CreateAgent {
  return {
    name: task.targetName,
    configId: MIGRATED_AGENT_CONFIG_ID,
    color: task.color,
    migration: true,
  };
}

/** A cloud agent that already exists, with its import marker (when probed). */
export interface ExistingCloudAgent {
  name: string;
  /** The `migration/status` marker's source, `null`/absent when never imported. */
  importedSource?: { workspace: string; agent: string } | null;
}

/**
 * Plan the migration: one task per legacy agent, flattened across workspaces.
 *
 * Target name = the agent's own name. On a collision — an existing cloud agent
 * or another task already claiming it — fall back to `"<Agent> (<Workspace>)"`,
 * then `"<Agent> (<Workspace>) 2"`, `… 3`, and so on. Names compare by the
 * host's own key (`agentNameKey`), so the plan never targets a name the
 * host's store would refuse as taken. A source named "Houston" keeps its name:
 * the move creates with `migration: true`, which the AI Manager's reserved
 * name does not refuse.
 *
 * Resume: a source agent whose `{workspace, agent}` matches an existing cloud
 * agent's import marker is `alreadyDone` — its target is that agent, and its
 * name never counts as a NEW collision (it IS the previous migration).
 */
export function buildMigrationPlan(
  sourceAgents: SourceAgent[],
  existing: ExistingCloudAgent[],
): MigrationTask[] {
  const taken = new Set(existing.map((a) => agentNameKey(a.name)));
  const tasks: MigrationTask[] = [];
  for (const src of sourceAgents) {
    const done = existing.find(
      (a) =>
        a.importedSource &&
        a.importedSource.workspace === src.workspaceId &&
        a.importedSource.agent === src.name,
    );
    if (done) {
      tasks.push({
        sourceId: src.id,
        workspace: src.workspaceId,
        agent: src.name,
        targetName: done.name,
        alreadyDone: true,
        manifest: src.manifest,
        color: src.color,
      });
      continue;
    }
    let targetName = src.name;
    if (taken.has(agentNameKey(targetName))) {
      const base = `${src.name} (${src.workspaceId})`;
      targetName = base;
      for (let n = 2; taken.has(agentNameKey(targetName)); n++) {
        targetName = `${base} ${n}`;
      }
    }
    taken.add(agentNameKey(targetName));
    tasks.push({
      sourceId: src.id,
      workspace: src.workspaceId,
      agent: src.name,
      targetName,
      alreadyDone: false,
      manifest: src.manifest,
      color: src.color,
    });
  }
  return tasks;
}

/**
 * Could this existing cloud agent be a previous run's output? Every possible
 * target name starts with a source agent's own name (exact, or
 * `"<Agent> (<Workspace>)…"`), so the resume probe only wakes those pods —
 * probing an unrelated sleeping agent would stall planning on its cold start.
 */
export function isPlausibleMigrationTarget(
  name: string,
  sourceAgents: Pick<SourceAgent, "name">[],
): boolean {
  const n = agentNameKey(name);
  return sourceAgents.some((s) => {
    const base = agentNameKey(s.name);
    return n === base || n.startsWith(`${base} (`);
  });
}
