import { createHash } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 */
export async function createTurnRoot(
  id: TurnRootIdentity,
  base: string = tmpdir(),
): Promise<string> {
  const root = conversationTurnRoot(id, base);
  try {
    await mkdir(root, { mode: 0o700 });
    return root;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const fallback = await mkdtemp(join(base, TURN_ROOT_PREFIX));
  console.info(
    `[turn] conversation root ${root} already exists (a concurrent or leftover turn); running in ${fallback}, so this turn misses the prompt cache`,
  );
  return fallback;
}
