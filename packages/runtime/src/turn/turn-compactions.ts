import { join } from "node:path";
import {
  type CompactionCheckpoints,
  createCompactionCheckpoints,
} from "../store/conversation-compaction";

/**
 * The Claude compaction checkpoints of a pooled turn's hydrated tree. The
 * process default points at the worker's own data dir, where no conversation
 * a pooled turn runs ever lives: a summary armed there would never reach its
 * conversation, and one a pod armed would never be read.
 */
export function turnCompactions(dataDir: string): CompactionCheckpoints {
  return createCompactionCheckpoints(join(dataDir, "conversations"));
}

/**
 * Settle the conversation's armed Claude summary before the session opens, and
 * report whether one is still armed for this turn to deliver. A fresh session
 * (a harness switch, a routine reset, an unreadable tail) starts from the
 * transcript replay, so a summary of the old session must not ride along: the
 * standing server retires it the same way when a chat leaves Claude
 * (session/conversation-switch.ts).
 */
export function settleClaudeSummary(
  dataDir: string,
  conversationId: string,
  turn: { harness: "claude" | "pi"; freshSession: boolean },
): boolean {
  const checkpoints = turnCompactions(dataDir);
  if (turn.freshSession) {
    checkpoints.clear(conversationId);
    return false;
  }
  return (
    turn.harness === "claude" && checkpoints.read(conversationId) !== undefined
  );
}
