import { type ConversationVM, conversationScope } from "@houston/sdk";
import { liveTurn } from "./turn-stream";
import { conversationStore } from "./vm";

/**
 * Whether the conversation's queue must wait: the VM shows a running turn, or
 * a send of this client's is still waiting to go out (held behind a turn,
 * waiting for room, or handing off over an observer). The second covers an
 * observer that settled the turn it watched meanwhile and flipped the VM
 * idle: a new message queues behind the waiting one, and nothing flushes
 * over it.
 */
export function conversationBusy(
  agentPath: string,
  sessionKey: string,
): boolean {
  const snap = conversationStore.getSnapshot(
    conversationScope(agentPath, sessionKey),
  ) as ConversationVM | undefined;
  return snap?.running === true || liveTurn(agentPath, sessionKey) === "held";
}
