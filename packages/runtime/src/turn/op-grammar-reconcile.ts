import type { ChatMessage } from "@houston/protocol";
import { ID, str } from "./op-grammar-fields";

/**
 * Settle what a pooled turn left behind when it died without settling itself
 * (its claim expired or its follower gave up): the run row of a routine fire
 * and the conversation's missing reply. The control plane sends it; nothing
 * else does. Leaf module: op-grammar imports it, so it may not import
 * op-grammar back.
 */
export interface ReconcileOp {
  kind: "reconcile";
  /** The conversation the op claims, and the only one it settles. */
  conversationId: string;
  /** Absent: settle the conversation's stale running rows only. */
  abandoned?: AbandonedTurn;
}

export interface AbandonedTurn {
  turnId: string;
  /** When the turn's first claim was granted: a lost run's start. */
  startedAt: string;
  /** The claim ran a routine fire (a chat turn in a routine's chat is not one). */
  routine: boolean;
  /** The transcript store's copy of the turn's user message, sent only when
   *  it is the conversation's last message and nothing answered it. */
  userMessage?: ChatMessage;
}

export function parseReconcileOp(raw: Record<string, unknown>): ReconcileOp {
  const conversationId = str(raw.conversationId, "op.conversationId");
  if (!ID.test(conversationId) || conversationId.includes(".."))
    throw new Error("invalid 'op.conversationId'");
  if (raw.abandoned === undefined) return { kind: "reconcile", conversationId };
  return {
    kind: "reconcile",
    conversationId,
    abandoned: parseAbandoned(raw.abandoned),
  };
}

function parseAbandoned(raw: unknown): AbandonedTurn {
  if (!raw || typeof raw !== "object")
    throw new Error("invalid 'op.abandoned'");
  const a = raw as Record<string, unknown>;
  const turnId = str(a.turnId, "op.abandoned.turnId");
  if (!ID.test(turnId)) throw new Error("invalid 'op.abandoned.turnId'");
  const startedAt = str(a.startedAt, "op.abandoned.startedAt");
  if (!Number.isFinite(Date.parse(startedAt)))
    throw new Error("invalid 'op.abandoned.startedAt'");
  const userMessage =
    a.userMessage === undefined
      ? undefined
      : parseUserMessage(a.userMessage, turnId);
  return {
    turnId,
    startedAt,
    routine: a.routine === true,
    ...(userMessage ? { userMessage } : {}),
  };
}

function parseUserMessage(raw: unknown, turnId: string): ChatMessage {
  const m = raw as Partial<ChatMessage> | null;
  if (
    !m ||
    typeof m !== "object" ||
    m.role !== "user" ||
    m.turnId !== turnId ||
    typeof m.content !== "string" ||
    typeof m.ts !== "number" ||
    !Number.isFinite(m.ts)
  ) {
    throw new Error("invalid 'op.abandoned.userMessage'");
  }
  return m as ChatMessage;
}
