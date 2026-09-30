/**
 * What the next scripted turn says, as a spec arms it through `/__test__/*`:
 * its exact reply text and the interaction it ends on. The tool calls it makes
 * live in `chat-tools.ts`; the turn itself in `chat-turn.ts`.
 */

import type { PendingInteraction } from "@houston/protocol";
import { takeToolCalls } from "./chat-tools";
import { MARKDOWN_SHOWCASE } from "./markdown-showcase";

/**
 * Arm the NEXT scripted turn to end on a pending interaction — its `done` frame
 * carries it, so the client settles the card to `needs_you` and drives the
 * composer-replacing question/connect card (element 4's e2e). One-shot:
 * consumed when that turn finishes. `null` disarms.
 */
let nextInteraction: PendingInteraction | null = null;
export function setNextInteraction(pi: PendingInteraction | null): void {
  nextInteraction = pi;
}

/**
 * Arm the NEXT scripted turn to reply with this exact text instead of the
 * echo — how a spec makes "the agent said X" happen (e.g. the in-app
 * onboarding's email-sent completion marker). One-shot: consumed by the next
 * turn. `null` disarms.
 */
let nextReplyText: string | null = null;
export function setNextReplyText(text: string | null): void {
  nextReplyText = text;
}

export function cannedReply(userText: string): string {
  if (nextReplyText !== null) {
    const reply = nextReplyText;
    nextReplyText = null;
    return reply;
  }
  if (/markdown/i.test(userText)) return MARKDOWN_SHOWCASE;
  return `Roger that. You said: "${userText}"`;
}

/** Three deltas so the UI exercises accumulation, not a single blob. */
export function replyDeltas(reply: string): string[] {
  const third = Math.ceil(reply.length / 3);
  return [
    reply.slice(0, third),
    reply.slice(third, third * 2),
    reply.slice(third * 2),
  ];
}

/** The armed interaction, disarmed as it is taken. */
export function takeInteraction(): PendingInteraction | null {
  const interaction = nextInteraction;
  nextInteraction = null;
  return interaction;
}

/** Disarm every one-shot (test reset). */
export function resetScript(): void {
  nextInteraction = null;
  nextReplyText = null;
  takeToolCalls();
}
