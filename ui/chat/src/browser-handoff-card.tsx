"use client";

import { GlobeIcon } from "lucide-react";
import type { BrowserHandoffCardState } from "./browser-live-types";

export interface BrowserHandoffCardLabels {
  /** The heading when the hand-off names a site. */
  heading: (site: string) => string;
  /** The heading when it does not. */
  headingNoSite: string;
  open: string;
  /** The Open button's accessible name. */
  openLabel: (site: string | null) => string;
  done: string;
  cancelled: string;
  expired: string;
  ended: string;
}

export const DEFAULT_BROWSER_HANDOFF_CARD_LABELS: BrowserHandoffCardLabels = {
  heading: (site) => `Your turn on ${site}`,
  headingNoSite: "Your turn in the browser",
  open: "Open",
  openLabel: (site) =>
    site ? `Open the browser for ${site}` : "Open the browser",
  done: "Done",
  cancelled: "Not finished",
  expired: "Time ran out",
  ended: "No longer waiting",
};

export interface BrowserHandoffCardProps {
  site: string | null;
  /** What the agent asked the person to do, in its own words. */
  task: string;
  state: BrowserHandoffCardState;
  onOpen?: () => void;
  labels?: Partial<BrowserHandoffCardLabels>;
}

function outcomeLabel(
  state: Exclude<BrowserHandoffCardState, "waiting">,
  labels: BrowserHandoffCardLabels,
): string {
  switch (state) {
    case "done":
      return labels.done;
    case "cancelled":
      return labels.cancelled;
    case "expired":
      return labels.expired;
    case "ended":
      return labels.ended;
  }
}

/**
 * The in-chat card for a browser hand-off: the agent is waiting for the person
 * to do something on a website themselves (sign in, a code, a captcha). Open
 * shows only while it waits; afterwards the card keeps the outcome.
 */
export function BrowserHandoffCard({
  site,
  task,
  state,
  onOpen,
  labels: labelOverrides,
}: BrowserHandoffCardProps) {
  const labels = { ...DEFAULT_BROWSER_HANDOFF_CARD_LABELS, ...labelOverrides };
  const heading = site ? labels.heading(site) : labels.headingNoSite;
  return (
    <div
      className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-line/60 bg-input p-3 md:max-w-md"
      data-state={state}
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-chip text-ink-muted"
      >
        <GlobeIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{heading}</p>
        {task ? (
          <p className="line-clamp-2 text-xs text-ink-muted">{task}</p>
        ) : null}
        {state !== "waiting" ? (
          <p className="text-xs text-ink-muted">
            {outcomeLabel(state, labels)}
          </p>
        ) : null}
      </div>
      {state === "waiting" ? (
        <button
          aria-label={labels.openLabel(site)}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-action px-4 text-sm font-medium text-action-text outline-none transition-transform hover:bg-action/70 focus-visible:ring-[3px] focus-visible:ring-focus/50 active:scale-[0.96] disabled:cursor-default disabled:opacity-50"
          disabled={!onOpen}
          onClick={onOpen}
          type="button"
        >
          {labels.open}
        </button>
      ) : null}
    </div>
  );
}
