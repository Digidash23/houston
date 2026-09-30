import type { ChatMessage } from "@houston/runtime-client";

/**
 * Cross-BACKEND provider-switch replay (HOU-951). A switch that crosses the
 * backend seam (pi ⇄ Claude Agent SDK) rebuilds the session on the other
 * backend, and neither backend can read the other's session store — so the
 * fresh session would start with zero context and greet the user as a new
 * conversation. Houston's canonical transcript (store/conversations) has every
 * turn regardless of which backend ran it; this module renders that transcript
 * into a preamble exec-turn prepends to the FIRST prompt on the rebuilt
 * session. Riding the first user prompt (not the system prompt) makes the
 * carried context durable: both backends persist the prompt in their own
 * session store, so later rehydrates (process restart, LRU eviction) keep it.
 */

/**
 * Same fit fraction as the same-backend switch decision (`provider-switch.ts`)
 * and the frontend consent dialog (`app/src/lib/provider-switch.ts`): the
 * replayed transcript may use up to this fraction of the target window, leaving
 * headroom for the system prompt, the new turn, and re-tokenization drift.
 */
const REPLAY_FIT_FRACTION = 0.8;

/** ~4 chars per token — the same coarse estimate the frontend dialog uses. */
const CHARS_PER_TOKEN = 4;

/**
 * The character budget for a replay preamble into a model whose effective
 * window is `targetWindowTokens`.
 */
export function replayCharBudget(targetWindowTokens: number): number {
  return Math.max(
    0,
    Math.floor(targetWindowTokens * REPLAY_FIT_FRACTION) * CHARS_PER_TOKEN,
  );
}

export interface ReplayPreamble {
  /** The rendered preamble, ready to prepend to the turn's prompt. */
  text: string;
  /** True when older messages were dropped to fit the budget (lossy carry). */
  truncated: boolean;
}

const HEADER =
  "[Continuing an existing conversation. The transcript below is what has " +
  "already been said in this chat; it ran on a different AI model before " +
  "switching to you. Continue seamlessly: keep all established context, do " +
  "not reintroduce yourself, and do not treat this as a new conversation.]";

/**
 * The session-reset variant (edit-and-resend, PRODUCT-1217): same carry, but
 * no provider switch happened, so the "different AI model" framing would be a
 * lie the model might echo back to the user.
 */
const RESET_HEADER =
  "[Continuing an existing conversation. The transcript below is what has " +
  "already been said in this chat. Continue seamlessly: keep all established " +
  "context, do not reintroduce yourself, and do not treat this as a new " +
  "conversation.]";

/**
 * The routine variant (routine-context.ts): a routine run whose chat outgrew
 * its budget starts on a fresh session, and this transcript is all it keeps of
 * the runs before it. It says what the transcript is FOR, so the run uses it
 * to avoid repeating the work and reports of earlier runs.
 */
const ROUTINE_HEADER =
  "[This automation has run before in this chat. To keep within your context " +
  "window, this run starts fresh: the transcript below is the most recent part " +
  "of the chat, kept as your memory of what earlier runs found, did and " +
  "reported. Use it to avoid repeating work or reports, then do this run's " +
  "work as instructed after the transcript.]";

const HEADERS = {
  switch: HEADER,
  reset: RESET_HEADER,
  routine: ROUTINE_HEADER,
};

/** Why a session is being rebuilt, which sets the preamble's framing. */
export type ReplayReason = keyof typeof HEADERS;

const TRUNCATION_NOTE =
  "(Earlier messages were omitted to fit your context window; the transcript below is the most recent part of the conversation.)";

const FOOTER = "[End of transcript. The user's next message follows.]";

/** One transcript line per message; empty (e.g. stop-marker) messages render to null. */
function renderMessage(m: ChatMessage): string | null {
  const toolNames = (m.tools ?? []).map((t) => t.name);
  const body =
    m.content.trim() ||
    (toolNames.length ? `[performed actions: ${toolNames.join(", ")}]` : "");
  if (!body) return null;
  const speaker =
    m.role === "user"
      ? m.author?.name
        ? `User (${m.author.name})`
        : "User"
      : "Assistant";
  return `${speaker}: ${body}`;
}

/**
 * Render the conversation-so-far preamble for a cross-backend rebuild, or null
 * when there is nothing to carry (a brand-new conversation). `currentTurnId`
 * excludes THIS turn's already-recorded user message — it is delivered as the
 * actual prompt, so replaying it too would double it. The newest messages are
 * kept whole and older ones dropped first when the transcript exceeds
 * `budget`, counted in characters unless `cost` says otherwise (a routine
 * replay counts tokens, token-estimate.ts).
 */
export function renderReplayPreamble(
  messages: ReadonlyArray<ChatMessage>,
  currentTurnId: string,
  budget: number,
  reason: ReplayReason = "switch",
  cost: ReplayCost = (text) => text.length,
): ReplayPreamble | null {
  if (budget <= 0) return null;
  const lines: string[] = [];
  for (const m of messagesVisibleToTheModel(messages)) {
    if (m.role === "user" && m.turnId === currentTurnId) continue;
    const line = renderMessage(m);
    if (line) lines.push(line);
  }
  if (lines.length === 0) return null;

  // Keep the tail: walk newest→oldest until the budget is spent. A single
  // over-budget message is hard-clipped (its tail kept) rather than dropped —
  // the most recent exchange is the context the user most expects to survive.
  const kept: string[] = [];
  let used = 0;
  let clipped = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const lineCost = cost(line);
    if (used + lineCost > budget) {
      if (kept.length === 0) {
        kept.unshift(`…${clipTail(line, budget, cost)}`);
        clipped = true;
      }
      break;
    }
    kept.unshift(line);
    used += lineCost + 1;
  }
  const truncated = clipped || kept.length < lines.length;
  return {
    text: [
      HEADERS[reason],
      ...(truncated ? [TRUNCATION_NOTE] : []),
      "",
      kept.join("\n\n"),
      "",
      FOOTER,
      "",
    ].join("\n"),
    truncated,
  };
}

/** What a replay budget counts: characters by default. */
export type ReplayCost = (text: string) => number;

/** The longest tail of `line` whose cost fits `budget` (cost grows with length). */
function clipTail(line: string, budget: number, cost: ReplayCost): string {
  let lo = 0;
  let hi = line.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cost(line.slice(mid)) <= budget) hi = mid;
    else lo = mid + 1;
  }
  return line.slice(lo);
}

/**
 * The tail of the transcript the MODEL is still allowed to see: everything
 * after the newest `/clear` marker, or all of it when the user never cleared.
 *
 * This is the one place the two audiences of a transcript diverge. The user's
 * history and `houston_recall` read the whole file; the model reads only what
 * has not been cleared. Without this window a session rebuild (a provider
 * switch, a mode flip that lands on the other backend) would replay the
 * cleared conversation straight back into the model that was told to forget it.
 */
function messagesVisibleToTheModel(
  messages: ReadonlyArray<ChatMessage>,
): ReadonlyArray<ChatMessage> {
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].contextCleared) return messages.slice(i + 1);
  return messages;
}
