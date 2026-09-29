import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import type { TurnRequest } from "./types";

/** Every turn root, conversation-named or fallback, carries this prefix. */
export const TURN_ROOT_PREFIX = "houston-turn-";

export type TurnRootIdentity = Pick<
  TurnRequest,
  "workspaceId" | "agentId" | "conversationId"
>;

/**
 * The root a conversation's turns run in. Its path reaches the model: the
 * agent's cwd sits under it, and the system prompt names the workspace/user
 * context files and every skill's SKILL.md by absolute path. The prompt cache
 * keys on exact bytes, so a random root per turn made every follow-up turn
 * rewrite the whole history. Named from the conversation, every turn of it on
 * any worker built from the same image sees the same paths.
 */
export function conversationTurnRoot(
  id: TurnRootIdentity,
  base: string = tmpdir(),
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([id.workspaceId, id.agentId, id.conversationId]))
    .digest("hex")
    .slice(0, 16);
  return join(base, `${TURN_ROOT_PREFIX}${digest}`);
}

/**
 * Create this turn's root, exclusively. An existing conversation root is
 * never reused or removed: a concurrent turn of the same conversation may be
 * running in it, or a turn whose cleanup timed out may still be hydrating into
 * it. Either way this turn takes a fresh random root instead, which only costs
 * it the prompt cache. Mode 0700 like the mkdtemp it replaces: the root holds
 * the turn's credential.
 *
 * With a tool shell (`shared`, default `config.toolShell`) the root is 1770
 * instead: model commands run as the tool user, a member of the group the
 * deployment's temp dir hands down (setgid), and must reach the workspace.
 * Sticky, so the tool user can rename or delete only what it owns here: it
 * cannot move this user's `home` or credential store aside and plant its
 * own. The credential files inside keep their own 0600.
 */
export async function createTurnRoot(
  id: TurnRootIdentity,
  base: string = tmpdir(),
  shared: boolean = config.toolShell !== null,
): Promise<string> {
  const root = conversationTurnRoot(id, base);
  try {
    await mkdir(root, { mode: 0o700 });
    if (shared) await openToGroup(root);
    return root;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const fallback = await mkdtemp(join(base, TURN_ROOT_PREFIX));
  if (shared) await openToGroup(fallback);
  console.info(
    `[turn] conversation root ${root} already exists (a concurrent or leftover turn); running in ${fallback}, so this turn misses the prompt cache`,
  );
  return fallback;
}

/**
 * chmod to sticky 0770 whatever the umask, keeping the setgid bit the
 * directory inherited: chmod(2) clears it unless it is in the new mode, and
 * without it files created inside would lose the tool user's group.
 */
async function openToGroup(dir: string): Promise<void> {
  const { mode } = await stat(dir);
  await chmod(dir, (mode & 0o2000) | 0o1770);
}
