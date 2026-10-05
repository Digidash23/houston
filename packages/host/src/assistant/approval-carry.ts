import type { ApprovalArg } from "@houston/protocol/approval";
import type { ApprovalRequest } from "./approval-record";
import type { ApprovalStore } from "./approvals";
import type { GuardReservation } from "./message-guard";

/**
 * ONE conversation's approval state, as a pool worker carries it from the turn
 * that raised a card to the turn the person's answer starts.
 *
 * A standing host keeps this in memory for as long as it runs. A pool worker
 * lives for one turn, and Houston's card is raised in one turn and answered by
 * the message that starts the next, so the records travel (the worker keeps
 * them beside the agent's other state, `turn/turn-approvals.ts`). What travels
 * is exactly what the store holds: the requests, with their expiry, and the
 * message reservations that stop a retried message minting twice. Grants do
 * not travel: a grant belongs to the message that carried it, for that turn.
 *
 * Adoption never trusts the shape: a malformed entry, an expired one, or one
 * scoped to another agent or conversation is dropped, so the worst a damaged
 * file can do is ask the person again.
 */
export interface ApprovalCarry {
  requests: ApprovalRequest[];
  reservations: GuardReservation[];
}

export function carryApprovals(
  store: ApprovalStore,
  agentId: string,
  conversationId: string,
): ApprovalCarry {
  return {
    requests: store.requestsFor(agentId, conversationId),
    reservations: store.messages.reservationsFor(agentId, conversationId),
  };
}

export function adoptApprovals(
  store: ApprovalStore,
  carry: unknown,
  scope: { agentId: string; conversationId: string },
): void {
  if (!isRecord(carry)) return;
  const requests = Array.isArray(carry.requests) ? carry.requests : [];
  for (const request of requests) {
    if (
      isApprovalRequest(request) &&
      request.agentId === scope.agentId &&
      request.conversationId === scope.conversationId
    )
      store.adopt(request);
  }
  const reservations = Array.isArray(carry.reservations)
    ? carry.reservations
    : [];
  for (const held of reservations) {
    if (isReservation(held))
      store.messages.adopt(scope.agentId, scope.conversationId, held);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function isArg(value: unknown): value is ApprovalArg {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.value) &&
    typeof value.long === "boolean" &&
    (value.truncated === undefined || isTime(value.truncated))
  );
}

function isApprovalRequest(value: unknown): value is ApprovalRequest {
  return (
    isRecord(value) &&
    isString(value.requestId) &&
    value.requestId !== "" &&
    isString(value.key) &&
    isString(value.operation) &&
    isString(value.agentId) &&
    isString(value.conversationId) &&
    isString(value.summary) &&
    (value.detail === undefined || isString(value.detail)) &&
    Array.isArray(value.args) &&
    value.args.every(isArg) &&
    isTime(value.createdAt) &&
    isTime(value.expiresAt) &&
    (value.decision === undefined ||
      value.decision === "approve" ||
      value.decision === "deny")
  );
}

function isReservation(value: unknown): value is GuardReservation {
  return (
    isRecord(value) &&
    isString(value.nonce) &&
    value.nonce !== "" &&
    isString(value.fingerprint) &&
    isTime(value.expiresAt)
  );
}
