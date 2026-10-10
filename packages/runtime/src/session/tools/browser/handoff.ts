import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { BrowserHandoffEnd } from "@houston/wire-types";
import type { ActingContext } from "../../acting-context";
import { decodeActingAuthor } from "../../attribution";
import type { BrowserAction } from "./actions";
import {
  type BrowserDetails,
  BrowserToolError,
  browserFailure,
} from "./errors";
import { clearFenceRefusal } from "./fence-refusals";
import { restoreLayout } from "./live/layout";
import type { HandoffRegistry } from "./live/registry";
import { guardLanding, openUrl, settle } from "./navigate";
import type { BrowserTab } from "./open-tab";
import { redactUrl } from "./redact-url";
import { nextGeneration } from "./refs";
import { pageSnapshot } from "./snapshot";
import { saveState } from "./state-store";
import { checkBrowserUrl } from "./url-policy";

export interface HandoffOptions {
  conversationId: string;
  owner?: string;
  signal?: AbortSignal;
  registry: HandoffRegistry;
  /**
   * How long the person gets, read once the page is loaded, so the wait in
   * the queue and the page load come off it; `null` means too little is left.
   */
  budget: () => number | null;
  /** Keeps the pool from sweeping the tab while the person uses it. */
  touch?: () => void;
}

/**
 * The person a hand-off is for: the gateway-signed acting-as, else the person
 * a pooled turn's verified record names. Never `actingUser`: a standing
 * runtime takes that from an unsigned header (the desktop's first-day turn
 * sends one), and a hand-off owned by it would refuse the desktop app itself.
 */
export function handoffOwner(
  acting: ActingContext | undefined,
): string | undefined {
  return decodeActingAuthor(acting?.actingAs)?.userId ?? acting?.verifiedOwner;
}

export const NO_TIME_LEFT =
  "This task has run too long to hand the browser over now. Tell the person what they need to sign in to, and that sending a new message gives them time to do it.";

/**
 * Hand the tab to the person and wait (up to the budget) until they finish,
 * cancel, or the turn is stopped; then save what they signed in to and give
 * the model a fresh look at the page. The person's typing never reaches the
 * model: only the page they leave behind does, passwords masked.
 */
export async function runHandoff(
  tab: BrowserTab,
  action: Extract<BrowserAction, { action: "handoff" }>,
  options: HandoffOptions,
): Promise<AgentToolResult<BrowserDetails>> {
  if (action.url) {
    clearFenceRefusal(tab);
    await openUrl(tab, checkBrowserUrl(action.url).href);
    await settle(tab.page);
    await guardLanding(tab);
  }
  const limitMs = options.budget();
  if (limitMs === null)
    return browserFailure("handoff_unavailable", NO_TIME_LEFT);
  const session = options.registry.open({
    conversationId: options.conversationId,
    text: action.text,
    ...(options.owner ? { owner: options.owner } : {}),
    tab,
    limitMs,
    ...(options.touch ? { touch: options.touch } : {}),
  });
  let browserClosed = false;
  const onClose = () => {
    browserClosed = true;
    session.finish("cancelled");
  };
  const onAbort = () => session.finish("cancelled");
  tab.context.on("close", onClose);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  let end: BrowserHandoffEnd;
  try {
    end = await session.ended;
  } finally {
    tab.context.off("close", onClose);
    options.signal?.removeEventListener("abort", onAbort);
  }
  if (browserClosed)
    throw new BrowserToolError(
      "page_error",
      "The browser closed while the person was using it.",
    );
  await restoreLayout(tab);
  await saveState(tab);
  // The person may have changed the page: refs from before are stale either way.
  tab.generation = nextGeneration();
  return handoffResult(tab, action.text, end, options.signal);
}

async function handoffResult(
  tab: BrowserTab,
  text: string,
  end: BrowserHandoffEnd,
  signal: AbortSignal | undefined,
): Promise<AgentToolResult<BrowserDetails>> {
  // A stopped turn reads nothing more; it only needed the sign-ins saved.
  if (end === "cancelled" || signal?.aborted)
    return browserFailure(
      "handoff_cancelled",
      "The person closed the browser without finishing. Ask them in the chat how they want to go on; do not hand over again unless they ask.",
    );
  if (end === "expired")
    return browserFailure(
      "handoff_expired",
      "Nobody finished in time. Tell the person what is still needed and offer to try again when they are ready.",
    );
  await settle(tab.page);
  const snapshot = await pageSnapshot(tab);
  return {
    content: [
      {
        type: "text",
        text: `The person finished: "${text}". Their sign-ins are saved. Check the page below before going on.\n\n${snapshot}`,
      },
    ],
    details: { ok: true, action: "handoff", url: redactUrl(tab.page.url()) },
  };
}
