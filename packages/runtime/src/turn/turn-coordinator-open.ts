import { ApprovalMessageRefusal } from "@houston/host/src/assistant/message-receipts";
import { openTurnApprovals, type TurnApprovals } from "./turn-approvals";
import type { TurnCoordinatorInput } from "./turn-coordinator";
import { receiveTurnMessage } from "./turn-coordinator-message";

/**
 * How Houston's turn was admitted: its approval records open with the
 * message's answers applied, the message refused (a nonce reused for other
 * words, which a standing host answers 409 before any turn starts), or the
 * records unreadable. Only the first lets anything that needs the host run.
 */
export type CoordinatorAdmission =
  | { kind: "admitted"; approvals: TurnApprovals }
  | { kind: "refused"; code: ApprovalMessageRefusal["code"] }
  | { kind: "unavailable" };

export async function admitCoordinatorTurn(
  input: TurnCoordinatorInput,
  agentId: string,
): Promise<CoordinatorAdmission> {
  try {
    const approvals = await openTurnApprovals(
      {
        store: input.store,
        prefix: input.prefix,
        filesystem: input.filesystem,
        agentId,
        conversationId: input.turn.conversationId,
      },
      (store, admitted) =>
        receiveTurnMessage(store, admitted, agentId, input.turn),
    );
    return { kind: "admitted", approvals };
  } catch (error) {
    if (error instanceof ApprovalMessageRefusal)
      return { kind: "refused", code: error.code };
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}` : "error";
    console.error(`[turn-coordinator] approvals unavailable (${detail})`);
    return { kind: "unavailable" };
  }
}
