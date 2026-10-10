/**
 * Which chat items are browser hand-offs, and what each card says: waiting for
 * the person, or how it ended. Pure over the feed a surface already holds; the
 * outcome is read from the `browser` tool's own result (`ERROR handoff_*:`),
 * so no wire field was added for it.
 *
 * Published as `@houston/sdk/browser-handoff` so the app's pure feed mapping
 * imports it without the SDK barrel.
 */

import { browserHandoffFailureOf } from "@houston/wire-types";

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

export interface BrowserHandoffFeedItem {
  id?: string;
  feed_type: string;
  data: unknown;
}

/** The `browser` tool, bare (pi) or MCP-prefixed (Claude: `mcp__houston__browser`). */
export function isBrowserToolName(name: string): boolean {
  return name === "browser" || name.endsWith("__browser");
}

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : null;
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

interface Call {
  index: number;
  name: string;
  input: Fields | null;
  result: number | null;
}

function stateOf(
  items: readonly BrowserHandoffFeedItem[],
  call: Call,
  waiting: boolean,
): BrowserHandoffCardState {
  if (call.result === null) return waiting ? "waiting" : "ended";
  const result = fields(items[call.result]?.data);
  if (result?.is_error !== true) return "done";
  const failure = browserHandoffFailureOf(String(result.content ?? ""));
  if (failure === "handoff_cancelled") return "cancelled";
  if (failure === "handoff_expired") return "expired";
  return "ended";
}

/** The url the turn's browser was last pointed at before `before`. */
function turnSite(
  calls: readonly Call[],
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
 * One card per hand-off call, in feed order. An unanswered call is `waiting`
 * only while a turn runs and nothing after it shows the turn moved on (a later
 * tool call or a turn's end); a person's message written while it waits does
 * not end it, because the turn queues that message behind the hand-off.
 */
export function browserHandoffCards(
  items: readonly BrowserHandoffFeedItem[],
  turnRunning: boolean,
): BrowserHandoffCardModel[] {
  const calls: Call[] = [];
  const turnEnds: number[] = [];
  items.forEach((item, index) => {
    const data = fields(item.data);
    if (item.feed_type === "final_result") turnEnds.push(index);
    if (item.feed_type === "tool_call") {
      // Claude's block-start placeholder (null input) is re-emitted with input.
      if (!data || data.input == null) return;
      calls.push({
        index,
        name: String(data.name ?? ""),
        input: fields(data.input),
        result: null,
      });
    }
    if (item.feed_type === "tool_result") {
      // Tools settle in call order: the first open call by that name answers.
      const name = typeof data?.name === "string" ? data.name : null;
      const open = calls.find(
        (c) => c.result === null && (name === null || c.name === name),
      );
      if (open) open.result = index;
    }
  });
  const cards: BrowserHandoffCardModel[] = [];
  calls.forEach((call, position) => {
    if (!isBrowserToolName(call.name) || call.input?.action !== "handoff")
      return;
    const url = str(call.input.url);
    const movedOn =
      position < calls.length - 1 || turnEnds.some((end) => end > call.index);
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
      state: stateOf(items, call, turnRunning && !movedOn),
    });
  });
  return cards;
}
