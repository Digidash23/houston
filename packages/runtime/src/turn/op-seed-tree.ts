import { join } from "node:path";
import { LocalPaths } from "@houston/host/src/paths";
import { seedAgentTree } from "@houston/host/src/routes/agent-seed-tree";
import { LocalWorkspaceStore } from "@houston/host/src/store/local";
import { FsVfs } from "@houston/host/src/vfs";
import type { SeedOp } from "./op-grammar-seed";

/** A seeded tree on local disk, keyed like the store (`workspaces/...`). */
export interface SeedTree {
  /** The engine agent id, `<Workspace>/<Agent>`. */
  id: string;
  workspaceRel: string;
}

/**
 * Write an agent's create-time files under `storeRoot` exactly as the pod's
 * `POST /agents` does: the personal workspace a fresh tree yields, the
 * create-time folder claim, then the shared seedAgentTree. `existing` names
 * an adopted tree's folder instead, so its missing payload files come out of
 * the very same function; `pruneListed` then drops what the store holds.
 */
export async function buildSeedTree(
  storeRoot: string,
  op: SeedOp,
  routineCreatedBy: string | undefined,
  existing?: { workspaceId: string; name: string },
): Promise<SeedTree> {
  const workspacesRoot = join(storeRoot, "workspaces");
  const workspaces = new LocalWorkspaceStore(workspacesRoot);
  const workspaceId =
    existing?.workspaceId ??
    (await workspaces.getOrCreatePersonalWorkspace(routineCreatedBy ?? "")).id;
  const agent = await workspaces.createAgent({
    workspaceId,
    name: existing?.name ?? op.name,
  });
  const workspace = await workspaces.getWorkspace(workspaceId);
  if (!workspace) throw new Error(`seed: no workspace folder ${workspaceId}`);
  await seedAgentTree(
    { store: workspaces, vfs: new FsVfs(workspacesRoot) },
    agent,
    new LocalPaths().agentRoot(workspace, agent),
    {
      ...(op.claudeMd !== undefined ? { claudeMd: op.claudeMd } : {}),
      ...(op.seeds ? { seeds: op.seeds } : {}),
    },
    routineCreatedBy,
  );
  return { id: agent.id, workspaceRel: `workspaces/${agent.id}` };
}

/** Delete every seeded file the store already holds: create-only means
 *  those are never uploaded, and what stays on disk is exactly what lands.
 *  A file whose path collides with a listed one (a listed FILE where the
 *  seed puts a directory, or the other way round) is dropped too: both in
 *  one prefix break every later hydrate, and the tree's own file wins. */
export async function pruneListed(
  storeRoot: string,
  tree: SeedTree,
  listed: ReadonlySet<string>,
): Promise<void> {
  const local = new FsVfs(storeRoot);
  for (const key of await local.list(tree.workspaceRel)) {
    if (listed.has(key)) {
      await local.deleteKey(key);
    } else if (collidesWithListed(key, listed)) {
      console.warn(
        `[op] seed completion skipped ${key}: the tree holds a colliding path`,
      );
      await local.deleteKey(key);
    }
  }
}

function collidesWithListed(key: string, listed: ReadonlySet<string>): boolean {
  const parts = key.split("/");
  for (let i = 1; i < parts.length; i++)
    if (listed.has(parts.slice(0, i).join("/"))) return true;
  const asDir = `${key}/`;
  for (const other of listed) if (other.startsWith(asDir)) return true;
  return false;
}
