/**
 * The marker that tags a user message Houston sent on the user's behalf.
 *
 * The provider has no "resume without a prompt" concept, so continuing a task
 * needs a USER turn — but the user never typed it, and a visible bubble would
 * read as if they had. Tagging the text lets the model receive the instruction
 * verbatim (it ignores the leading HTML comment) while every transcript
 * filters the bubble out.
 *
 * Lives in the protocol because both sides of the wire mint it: the app
 * (`app/src/lib/auto-continue-message.ts`, which also owns the feed filter)
 * and the runtime's own resume after an engine restart
 * (`packages/runtime/src/session/resume-interrupted-turns.ts`). A drift
 * between two copies of this string would show the user a raw prompt they
 * never wrote.
 */
export const AUTO_CONTINUE_MARKER = "<!--houston:auto_continue-->";

/** Wrap agent-bound text so a transcript can recognize and hide it. */
export function encodeAutoContinue(text: string): string {
  return `${AUTO_CONTINUE_MARKER}\n\n${text}`;
}

/** True for a message Houston auto-sent to resume a task. */
export function isAutoContinue(content: string): boolean {
  return content.startsWith(AUTO_CONTINUE_MARKER);
}

/**
 * The marker that tags the AI Manager's daily morning briefing turn.
 *
 * It rides INSIDE an auto-continue message, on the line after its blank line,
 * so every transcript already hides the bubble and the model reads two
 * leading HTML comments it ignores. Channels (Slack, WhatsApp) recognize a
 * briefing turn by the exact prefix. The local host and the cloud gateway
 * both mint these bytes, so the layout is a contract: change it in both.
 */
export const HEARTBEAT_MARKER = "<!--houston:heartbeat-->";

const HEARTBEAT_PREFIX = `${AUTO_CONTINUE_MARKER}\n\n${HEARTBEAT_MARKER}\n`;

/** The briefing's hidden user message: `AUTO_CONTINUE_MARKER + "\n\n" +
 *  HEARTBEAT_MARKER + "\n" + prompt`. */
export function encodeHeartbeat(prompt: string): string {
  return encodeAutoContinue(`${HEARTBEAT_MARKER}\n${prompt}`);
}

/** True for the hidden message of a morning briefing turn. */
export function isHeartbeat(content: string): boolean {
  return content.startsWith(HEARTBEAT_PREFIX);
}
