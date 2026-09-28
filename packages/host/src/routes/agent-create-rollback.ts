import type { Agent } from "../domain/types";
import type { WorkspaceStore } from "../ports";
import type { Vfs } from "../vfs";

/**
 * Run a new agent's first writes (schemas, CLAUDE.md, seeds) as one
 * atomic-enough step: when any of them throws, the record and its folder are
 * rolled back so a retry recreates cleanly (a half-made agent would otherwise
 * hold the name and refuse every retry with 409 `name_taken`), then the
 * ORIGINAL error is rethrown so the failure still reaches the client.
 *
 * `agent` must be the one `store.createAgent` just returned for THIS request:
 * the store refuses a taken name, so the rollback can only ever reach a folder
 * this request created, never an existing employee's.
 */
export async function seedOrRollBack(
  deps: { store: WorkspaceStore; vfs: Vfs },
  agent: Agent,
  root: string,
  seed: () => Promise<void>,
): Promise<void> {
  try {
    await seed();
  } catch (err) {
    try {
      // Record first: the desktop store resolves an agent BY its folder, so
      // deleting the folder first makes `deleteAgent` refuse an agent it can
      // no longer find. `deletePrefix` then clears whatever the store's own
      // delete left (a no-op when that was the folder itself).
      await deps.store.deleteAgent(agent.id);
      await deps.vfs.deletePrefix(root);
    } catch (rollbackErr) {
      // The original cause is what the client needs; this breadcrumb names
      // the orphaned record/folder the failed rollback left behind.
      console.error(
        `[agents] seed rollback failed for ${agent.id}:`,
        rollbackErr instanceof Error ? rollbackErr.message : rollbackErr,
      );
    }
    throw err;
  }
}
