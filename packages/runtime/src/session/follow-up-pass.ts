import type { ForcedToolCall } from "../backends/forced-tool-call";
import type { HarnessSession } from "../backends/types";
import {
  type InteractionHolder,
  recordSuggestActions,
  runWithInteractionCapture,
} from "./interaction";
import { isRoutineConversation } from "./routine-context";
import {
  parseSuggestedActions,
  SUGGEST_ACTIONS_TOOL_NAME,
} from "./tools/suggest-actions";

/**
 * The follow-up safety net. The product prompt makes `suggest_actions`
 * mandatory on every non-blocking turn, and Claude complies, but GPT models
 * treat their closing text as the end of the turn and never call it. When a
 * turn ends cleanly with a reply and nothing recorded, ONE hidden forced
 * request asks the model for the call, and its actions land on the same
 * terminal frame as if the model had called it in-band.
 *
 * The request runs outside the session (`HarnessSession.forceToolCall`): no
 * wire frame reaches the client (a stray text or tool frame would bounce the
 * board card back to running), and nothing is persisted, so the next turn's
 * transcript holds no instruction and no call without a result. Bounded: on a
 * timeout or any failure the turn ends normally, without bubbles, and the
 * reason is logged.
 */

/** Long enough for a cached minimal-reasoning call, short enough to wait on. */
export const FOLLOW_UP_PASS_TIMEOUT_MS = 9_000;

const INSTRUCTION = `[Houston] Your reply above is complete and the user has already read it. Do not write any text. Call ${SUGGEST_ACTIONS_TOOL_NAME} now with 2 to 4 concrete follow-up actions grounded in this conversation, written in the language the user writes in. Call no other tool.`;

export type FollowUpPassSkip =
  | "failed"
  | "unsupported"
  | "plan"
  | "no_reply"
  | "answered"
  | "routine";

export interface FollowUpPassInput {
  session: HarnessSession;
  interaction: InteractionHolder;
  conversationId: string;
  turnId: string;
  /** Plan mode, at the turn's start or after a mid-turn flip: no offer tool. */
  planMode: boolean;
  /** The turn's visible reply text. */
  assistantText: string;
  /** The turn errored, stalled or was stopped: no clean end to extend. */
  failed: boolean;
  /** Read again once the pass returns: a stop during it drops its actions. */
  isStopped: () => boolean;
  timeoutMs?: number;
}

/** Why the pass does not run for this turn, or null when it does. */
export function followUpPassSkip(
  input: FollowUpPassInput,
): FollowUpPassSkip | null {
  if (input.failed) return "failed";
  if (!input.session.forceToolCall) return "unsupported";
  if (input.planMode) return "plan";
  if (!input.assistantText.trim()) return "no_reply";
  // A blocking step (question, connect, credential, plan) already gives the
  // user something to do; a lone suggest_reusable offer composes with actions.
  const steps = input.interaction.pending?.steps ?? [];
  if (
    input.interaction.suggestActions ||
    steps.some((step) => step.kind !== "suggest_reusable")
  )
    return "answered";
  // An unattended run: nobody is there to click a bubble.
  if (isRoutineConversation(input.conversationId)) return "routine";
  return null;
}

type PassResult = ForcedToolCall | { outcome: "failed"; error: unknown };

/** Run the pass when the turn qualifies, recording its actions on success. */
export async function recoverFollowUpActions(
  input: FollowUpPassInput,
): Promise<void> {
  const forceToolCall = input.session.forceToolCall?.bind(input.session);
  if (!forceToolCall || followUpPassSkip(input)) return;
  const timeoutMs = input.timeoutMs ?? FOLLOW_UP_PASS_TIMEOUT_MS;
  const where = `conversation=${input.conversationId} turn=${input.turnId}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<{ outcome: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ outcome: "timeout" });
    }, timeoutMs);
  });
  // A failure becomes a value, so a rejection that lands after the timeout
  // won is never an unhandled one.
  const call: Promise<PassResult> = forceToolCall({
    toolName: SUGGEST_ACTIONS_TOOL_NAME,
    instruction: INSTRUCTION,
    signal: controller.signal,
  }).then(
    (result: ForcedToolCall): PassResult => result,
    (error: unknown): PassResult => ({ outcome: "failed", error }),
  );
  let result: PassResult | { outcome: "timeout" };
  try {
    result = await Promise.race([call, timedOut]);
  } finally {
    clearTimeout(timer);
  }
  // The user's Stop aborted the request: nothing failed, and its actions (if
  // any made it back) are no longer wanted.
  if (input.isStopped()) return;
  // Expected on every turn of a model that cannot be forced: no request was
  // sent, so nothing went wrong and nothing is worth more than a debug line.
  if (result.outcome === "unsupported") {
    console.debug(
      `[follow-up-pass] not forceable: ${result.reason} (${where})`,
    );
    return;
  }
  if (result.outcome === "unavailable") {
    console.info(`[follow-up-pass] skipped: ${result.reason} (${where})`);
    return;
  }
  if (result.outcome !== "called") {
    const why =
      result.outcome === "timeout"
        ? `timed out after ${timeoutMs} ms`
        : result.outcome === "failed"
          ? `failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`
          : `the model did not call ${SUGGEST_ACTIONS_TOOL_NAME}`;
    console.warn(
      `[follow-up-pass] ${why}; the turn ends without follow-up actions (${where})`,
    );
    return;
  }
  const actions = parseSuggestedActions(result.args);
  if (!actions) {
    console.warn(
      `[follow-up-pass] ${SUGGEST_ACTIONS_TOOL_NAME} arguments were invalid; the turn ends without follow-up actions (${where})`,
    );
    return;
  }
  runWithInteractionCapture(input.interaction, () =>
    recordSuggestActions({ actions }),
  );
  console.info(
    `[follow-up-pass] recovered ${actions.length} follow-up actions (${where})`,
  );
}
