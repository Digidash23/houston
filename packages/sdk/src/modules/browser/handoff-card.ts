/**
 * Which chat items are browser hand-offs, and what each card says: waiting for
 * the person, or how it ended. Pure over the feed a surface already holds; the
 * outcome is read from the `browser` tool's own result (`ERROR handoff_*:`),
 * so no wire field was added for it.
 * Where the cards sit in the chat: `handoff-layout.ts`.
 */

import { browserHandoffFailureOf } from "@houston/wire-types";
import {
  type BrowserHandoffFeedItem,
  type FeedCall,
  feedCalls,
  fields,
} from "./handoff-calls";

export type { BrowserHandoffFeedItem } from "./handoff-calls";

export type BrowserHandoffCardState =
  | "waiting"
  | "done"
  | "cancelled"
  | "expired"
  | "ended";

export interface BrowserHandoffCardModel {
  /** `${callItem.id ?? index}:handoff` */
  key: string;
  /** Insert the card AFTER this item: the result if present, else the call. */
  anchorIndex: number;
  text: string;
  url: string | null;
  /** Hostname of `url`, else of the turn's latest browser `open`/`handoff` url. */
  site: string | null;
  state: BrowserHandoffCardState;
}

/** The `browser` tool, bare (pi) or MCP-prefixed (Claude: `mcp__houston__browser`). */
export function isBrowserToolName(name: string): boolean {
  return name === "browser" || name.endsWith("__browser");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null; // not an absolute URL: the card names no site rather than a wrong one
  }
}

function stateOf(
  items: readonly BrowserHandoffFeedItem[],
  call: FeedCall,
  waiting: boolean,
): BrowserHandoffCardState {
  if (call.result === null) return waiting ? "waiting" : "ended";
  const result = fields(items[call.result]?.data);
  const content = String(result?.content ?? "");
  // A successful hand-off always says so. An empty success is what the history
  // fold writes for a tool the turn never finished (stopped, crashed).
  if (result?.is_error !== true) return content.trim() ? "done" : "ended";
  const failure = browserHandoffFailureOf(content);
  if (failure === "handoff_cancelled") return "cancelled";
  if (failure === "handoff_expired") return "expired";
  return "ended";
}

/** The url the turn's browser was last pointed at before `before`. */
function turnSite(
  calls: readonly FeedCall[],
  before: number,
  turnStart: number,
): string | null {
  for (let i = before - 1; i >= 0 && calls[i].index > turnStart; i--) {
    const input = calls[i].input;
    if (!isBrowserToolName(calls[i].name) || !input) continue;
    if (input.action !== "open" && input.action !== "handoff") continue;
    const site = hostOf(str(input.url));
    if (site) return site;
  }
  return null;
}

/**
 * Whether anything after `position` shows its turn went on without it: a turn
 * end, a later call that already has its result (tools run one at a time, so
 * the hand-off's own result would have come first), or a call of another turn.
 * A later call alone is not enough: a model may ask for the hand-off and
 * another tool in one message, and that call waits behind the hand-off.
 */
function movedOn(
  calls: readonly FeedCall[],
  position: number,
  turnEnds: readonly number[],
): boolean {
  const call = calls[position];
  if (turnEnds.some((end) => end > call.index)) return true;
  return calls
    .slice(position + 1)
    .some(
      (later) =>
        later.result !== null ||
        (later.turnId !== undefined &&
          call.turnId !== undefined &&
          later.turnId !== call.turnId),
    );
}

/**
 * One card per hand-off call, in feed order. An unanswered call is `waiting`
 * only while a turn runs and nothing after it shows the turn moved on; a
 * person's message written while it waits does not end it, because the turn
 * queues that message behind the hand-off.
 */
export function browserHandoffCards(
  items: readonly BrowserHandoffFeedItem[],
  turnRunning: boolean,
): BrowserHandoffCardModel[] {
  const { calls, turnEnds } = feedCalls(items);
  const cards: BrowserHandoffCardModel[] = [];
  calls.forEach((call, position) => {
    if (!isBrowserToolName(call.name) || call.input?.action !== "handoff")
      return;
    const url = str(call.input.url);
    cards.push({
      key: `${items[call.index].id ?? call.index}:handoff`,
      anchorIndex: call.result ?? call.index,
      text: str(call.input.text) ?? "",
      url,
      site:
        hostOf(url) ??
        turnSite(
          calls,
          position,
          Math.max(-1, ...turnEnds.filter((end) => end < call.index)),
        ),
      state: stateOf(
        items,
        call,
        turnRunning && !movedOn(calls, position, turnEnds),
      ),
    });
  });
  return cards;
}
