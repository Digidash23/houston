import { createHash } from "node:crypto";
import type { ApprovalStore } from "@houston/host/src/assistant/approvals";
import { prepareMessageReceipts } from "@houston/host/src/assistant/message-receipts";
import { messageRetryContent } from "@houston/protocol";
import type { AdmittedMessages } from "./turn-admitted-messages";
import type { TurnRequest } from "./types";

/**
 * Apply the person's message to Houston's approval records exactly as a
 * standing host's message route does (`assistant/message-receipts.ts`): their
 * answers decide the cards they name, every other card of the conversation
 * is retired, the message's grants are issued for this turn, and a retried
 * message (same nonce) changes nothing a second time.
 *
 * The body is rebuilt from the envelope's own fields, so the retry
 * fingerprint is the one the same message always produces, and the message is
 * recorded as admitted for a week (turn-admitted-messages.ts). Throws the host's
 * typed refusal for a message that may not mint anything (a nonce reused for
 * different words); the caller then performs no operation for this turn.
 */
export function receiveTurnMessage(
  approvals: ApprovalStore,
  admitted: AdmittedMessages,
  agentId: string,
  turn: TurnRequest,
): void {
  const body: Record<string, unknown> = {
    text: turn.text,
    mode: turn.mode,
    // Presence, not truthiness: an empty nonce is the host's to refuse.
    ...(turn.nonce !== undefined ? { nonce: turn.nonce } : {}),
    ...(turn.displayText ? { displayText: turn.displayText } : {}),
    ...(turn.provider ? { provider: turn.provider } : {}),
    ...(turn.model ? { model: turn.model } : {}),
    ...(turn.effort ? { effort: turn.effort } : {}),
    ...(turn.mentions ? { mentions: turn.mentions } : {}),
    ...(turn.approvals !== undefined ? { approvals: turn.approvals } : {}),
    ...(turn.grants ? { grants: turn.grants } : {}),
  };
  const actor = turn.actingAs?.userId ?? "";
  const prepared = prepareMessageReceipts({
    approvals,
    agentId,
    conversationId: turn.conversationId,
    actor,
    ...(turn.actingToken ? { grantActor: turn.actingToken } : {}),
    body: Buffer.from(JSON.stringify(body)),
    parsed: body,
    durableReceipt:
      turn.nonce !== undefined ? admitted.receipt(turn.nonce) : null,
  });
  if (turn.nonce && !prepared.duplicate)
    admitted.record(
      turn.nonce,
      createHash("sha256")
        .update(messageRetryContent(body, actor))
        .digest("hex"),
      turn.turnId ?? "pooled",
    );
}
