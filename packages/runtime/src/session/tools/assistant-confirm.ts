import type { AssistantOperation } from "@houston/host/src/assistant/catalog";
import { currentConversationId } from "../conversation-context";
import { recordConfirmation } from "../interaction";
import {
  type AssistantOperationResult,
  assistantErrorResult,
  assistantNeedsConfirmationResult,
} from "./assistant-result";
import type { SandboxFetch } from "./sandbox-fetch";
import { CONVERSATION_ID_HEADER } from "./save-learning";

/**
 * The gate `houston_call` runs every `confirm: true` operation through.
 *
 * NOTHING here decides an approval. The runtime asks the HOST for one
 * (`POST /sandbox/assistant/pending`). A live user-message grant returns a
 * receipt immediately; otherwise the host raises a card and the runtime hands
 * the model its `requestId` for the next call.
 * The host — the process holding the credential — matches that id against the
 * receipt from the user's answer or grant, so a runtime that skipped this gate
 * entirely still performs nothing.
 *
 * The wording comes back from the host with the request, so the sentence the
 * person read and the bytes their yes authorizes are decided in one place and
 * cannot drift apart. The model never authors either.
 */

/** The approve/deny answers. */
const APPROVE = { kind: "approval", id: "approve" } as const;
const DECLINE = { kind: "approval", id: "decline" } as const;

/** The host route that raises one approval request. */
const PENDING_PATH = "/sandbox/assistant/pending";

/** What the model is told while the user decides. It is an instruction, not a
 *  status: the failure mode this replaces is a model that "confirms" itself. */
function pendingMessage(
  name: string,
  summary: string,
  requestId: string,
): string {
  return `${name} was NOT performed. ${summary} The app is now showing the user an approval card with exactly these details, and only their own answer can authorize it - you cannot. END YOUR TURN NOW and wait: do not retry this call, do not ask the same thing again in your reply text, and do not work around the gate with other operations. Deleting something and recreating it is not a workaround; the deletion still needs this approval. Once they approve, repeat this exact call unchanged with requestId "${requestId}" and it will run, once.`;
}

/** What the model is told after the user said no. */
export function declinedMessage(name: string): string {
  return `The user was shown exactly what ${name} would do and said no. It has not been performed and it must not be: do not retry it, and do not reach the same outcome through other operations. Tell them plainly that you did not do it, then ask what they would like instead.`;
}

interface PendingReply {
  requestId: string;
  summary: string;
  preApproved?: true;
  /** The verbatim arguments the host could not fit in the sentence. */
  detail?: string;
}

function readPendingReply(payload: unknown): PendingReply | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { requestId, summary, detail, preApproved } = payload as {
    requestId?: unknown;
    summary?: unknown;
    detail?: unknown;
    preApproved?: unknown;
  };
  if (typeof requestId !== "string" || requestId === "") return null;
  return {
    requestId,
    ...(preApproved === true ? { preApproved: true as const } : {}),
    summary: typeof summary === "string" ? summary : "",
    ...(typeof detail === "string" && detail ? { detail } : {}),
  };
}

/**
 * Ask the host for one receipt or approval card. A pre-approved answer carries
 * an exact-call receipt; the other answer records the question and waits.
 */
export async function requestConfirmation(
  op: AssistantOperation,
  params: Record<string, unknown>,
  call: SandboxFetch,
  signal?: AbortSignal,
): Promise<
  AssistantOperationResult | { preApproved: true; requestId: string }
> {
  const conversationId = currentConversationId();
  // No conversation (a routine's unattended turn, or a direct call outside a
  // turn) means there is nowhere for an answer to arrive, so nothing can ever
  // authorize it. Refusing is the whole contract.
  if (!conversationId) {
    return assistantErrorResult(op.name, {
      code: "needs_confirmation",
      message: `${op.name} changes something the user cannot easily get back, and this turn has no one to ask. Do not retry it: tell the user what needs deciding the next time they are here.`,
    });
  }
  let res: Response;
  try {
    res = await call(PENDING_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONVERSATION_ID_HEADER]: conversationId,
      },
      body: JSON.stringify({ operation: op.name, params }),
      signal,
    });
  } catch (err) {
    return assistantErrorResult(op.name, {
      code: "transport_error",
      message: `The app could not be reached to ask the user about that: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  let pending: PendingReply | null = null;
  if (res.ok) {
    try {
      pending = readPendingReply(await res.json());
    } catch (err) {
      return assistantErrorResult(op.name, {
        code: "transport_error",
        status: res.status,
        message: `The app answered the approval request with unreadable data: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  if (!pending) {
    return assistantErrorResult(op.name, {
      code: "gateway_error",
      status: res.status,
      message: `The app could not put that in front of the user for approval (HTTP ${res.status}), so it has not been done. Tell them plainly and ask what they would like instead.`,
    });
  }
  if (pending.preApproved)
    return { preApproved: true, requestId: pending.requestId };

  recordConfirmation({
    question: pending.summary,
    ...(pending.detail ? { detail: pending.detail } : {}),
    options: [{ ...APPROVE }, { ...DECLINE }],
    requestId: pending.requestId,
  });
  return assistantNeedsConfirmationResult(
    op.name,
    pendingMessage(op.name, pending.summary, pending.requestId),
    { summary: pending.summary, params, requestId: pending.requestId },
  );
}
