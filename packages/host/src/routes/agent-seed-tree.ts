import { seedSchemas } from "@houston/domain";
import type { Agent } from "../domain/types";
import type { WorkspaceStore } from "../ports";
import type { Vfs } from "../vfs";
import { seedOrRollBack } from "./agent-create-rollback";
import { type AgentSeed, writeAgentSeeds } from "./agent-seed";

/**
 * A just-created agent's first files under `root`: the `.houston` JSON
 * schemas (so the agent and external tools can validate what they write),
 * then its CLAUDE.md and seed map. Any failed write rolls the record and the
 * folder back (seedOrRollBack) and rethrows.
 *
 * The pod's `POST /agents` and the pool worker's `seed` op both run this, so
 * an agent seeded while asleep holds exactly the files its pod would have
 * written. `routineCreatedBy` is the acting identity stamped as `created_by`
 * on every seeded routine (see stampRoutineCreator).
 */
export async function seedAgentTree(
  deps: { store: WorkspaceStore; vfs: Vfs },
  agent: Agent,
  root: string,
  seed: AgentSeed,
  routineCreatedBy?: string,
): Promise<void> {
  await seedOrRollBack(deps, agent, root, async () => {
    await seedSchemas(deps.vfs, root);
    await writeAgentSeeds(deps.vfs, root, seed, routineCreatedBy);
  });
}
