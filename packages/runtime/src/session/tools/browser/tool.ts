import {
  type AgentToolResult,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { BROWSER_HANDOFF_LIMIT_MS } from "@houston/wire-types";
import { currentActingContext } from "../../acting-context";
import { currentConversationId } from "../../conversation-context";
import { assertNotAutoMode, assertNotPlanMode } from "../../live-mode-gate";
import {
  type BrowserAction,
  type BrowserParams,
  browserParameters,
  parseBrowserAction,
} from "./actions";
import {
  type BrowserDetails,
  BrowserToolError,
  browserFailure,
} from "./errors";
import { handoffOwner, runHandoff } from "./handoff";
import { type HandoffRegistry, sharedHandoffs } from "./live/registry";
import { BROWSER_TOOL_NAME } from "./name";
import { type BrowserPool, sharedBrowserPool } from "./pool";
import { redactUrl } from "./redact-url";
import { runBrowserAction } from "./run-action";
import { browserStatePath, saveState } from "./state-store";

export interface BrowserToolOptions {
  /** The agent's workspace; its sign-ins live under `.houston/browser/`. */
  workspaceDir: string;
  /**
   * Whether this runtime can show the browser to the person (it serves the
   * live view routes): only then is `handoff` offered.
   */
  liveView: boolean;
  pool?: BrowserPool;
  handoffs?: HandoffRegistry;
  /** Tests shorten the person's 10 minutes. */
  handoffLimitMs?: number;
}

function description(liveView: boolean): string {
  return [
    "Use a real web browser: open pages, read them, click, type, and sign in to websites.",
    "Every action that changes the page returns a fresh snapshot of it; elements carry refs like [ref=s3e12], which click, fill and select take. Refs are only valid for the latest snapshot.",
    "Sign-ins are remembered for this agent across conversations.",
    "For plain downloads or APIs, the shell is faster; use this for pages that need signing in, clicking through, or JavaScript.",
    liveView
      ? "When a site needs the person themselves (signing in, a verification code, a captcha), first say in one sentence what they need to do, then call handoff with text naming it; it waits until they finish (up to 10 minutes) and returns the page. Never ask for a password or a code in chat."
      : "If a site asks for a password the user has not given you, stop and tell them they need to sign in themselves; never ask for a password in chat.",
  ].join(" ");
}

const NO_LIVE_VIEW =
  "There is no way to show this browser to the person here. Tell them what to sign in to.";

/**
 * The `browser` tool: a native Playwright-driven Chromium, not a CLI, so the
 * person's passwords never pass through a shell command and the call shows in
 * the tool-call log like every other tool. Built per workspace; the browser
 * process is shared ({@link sharedBrowserPool}) and each conversation gets
 * its own context.
 */
export function makeBrowserTool({
  workspaceDir,
  liveView,
  pool = sharedBrowserPool,
  handoffs = sharedHandoffs,
  handoffLimitMs = BROWSER_HANDOFF_LIMIT_MS,
}: BrowserToolOptions) {
  const statePath = browserStatePath(workspaceDir);
  const handOver = (
    key: string,
    action: Extract<BrowserAction, { action: "handoff" }>,
    signal: AbortSignal | undefined,
  ) => {
    assertNotAutoMode("hand the browser to the person");
    const conversationId = currentConversationId();
    if (!liveView || !conversationId)
      return browserFailure("handoff_unavailable", NO_LIVE_VIEW);
    // Taken now: the request that started the turn named who it is for.
    const owner = handoffOwner(currentActingContext());
    return pool.run(
      key,
      statePath,
      (tab) =>
        runHandoff(tab, action, {
          conversationId,
          ...(owner ? { owner } : {}),
          ...(signal ? { signal } : {}),
          registry: handoffs,
          limitMs: handoffLimitMs,
          touch: () => pool.touch(key),
        }),
      signal,
    );
  };
  return defineTool({
    name: BROWSER_TOOL_NAME,
    label: "Browse the web",
    description: description(liveView),
    parameters: browserParameters({ handoff: liveView }),
    executionMode: "sequential",
    async execute(
      _id: string,
      params: BrowserParams,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<BrowserDetails>> {
      assertNotPlanMode("use the browser");
      const key = `${workspaceDir}\0${currentConversationId() ?? "default"}`;
      try {
        const action = parseBrowserAction(params);
        if (action.action === "handoff")
          return await handOver(key, action, signal);
        if (action.action === "close") {
          await pool.closeTab(key);
          return {
            content: [
              {
                type: "text" as const,
                text: "Closed the browser. Sign-ins are saved.",
              },
            ],
            details: { ok: true, action: action.action },
          };
        }
        return await pool.run(
          key,
          statePath,
          async (tab) => {
            const outcome = await runBrowserAction(tab, action, signal);
            if (outcome.mutated) await saveState(tab);
            return {
              content: outcome.content,
              details: {
                ok: true,
                action: action.action,
                url: redactUrl(tab.page.url()),
              },
            };
          },
          signal,
        );
      } catch (error) {
        if (error instanceof BrowserToolError)
          return browserFailure(error.code, error.message);
        // The network fence (launch.ts) refusing a hop to this machine.
        if (
          error instanceof Error &&
          error.message.includes("net::ERR_PROXY_CONNECTION_FAILED")
        )
          return browserFailure(
            "url_refused",
            "That page sent the browser to an address on this computer, so it was stopped.",
          );
        if (error instanceof Error && isPageFailure(error))
          return browserFailure("page_error", firstLine(error.message));
        throw error;
      }
    },
  });
}

/** Playwright's own refusals: the model can recover by re-reading the page. */
function isPageFailure(error: Error): boolean {
  return (
    error.name === "TimeoutError" ||
    /^(page|frame|locator|keyboard|elementHandle|browserContext)\./.test(
      error.message,
    ) ||
    error.message.includes("net::")
  );
}

function firstLine(message: string): string {
  return `${message.split("\n")[0]} Take a snapshot to see the page as it is now.`;
}
