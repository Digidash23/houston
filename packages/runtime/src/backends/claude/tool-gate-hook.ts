import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
} from "@anthropic-ai/claude-agent-sdk";
import { buildTurnEndHooks } from "./turn-end-hook";

/** The SDK lets a tool run once a hook times out, so the gate answers first. */
const TOOL_GATE_TIMEOUT_S = 600;
export const TOOL_GATE_DENY_AFTER_MS = (TOOL_GATE_TIMEOUT_S - 10) * 1000;

function deny(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: reason,
    },
  };
}

/**
 * PreToolUse: hold every tool call, built-in or Houston MCP, until
 * `beforeTool` resolves. Hooks run for auto-approved calls too, which
 * `canUseTool` does not see. A rejection, an aborted turn or the deadline
 * denies the call with its reason instead of running it early.
 */
export function toolGateHook(beforeTool: () => Promise<void>): HookCallback {
  return async (_input, _toolUseId, { signal }) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("the agent's files are still loading")),
        TOOL_GATE_DENY_AFTER_MS,
      );
      const stopped = () => reject(new Error("the turn was stopped"));
      if (signal.aborted) stopped();
      else signal.addEventListener("abort", stopped, { once: true });
    });
    try {
      await Promise.race([beforeTool(), stop]);
      return {};
    } catch (error) {
      return deny(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The session's SDK hooks: the turn-end stop, plus the tool gate if any. */
export function buildSessionHooks(
  beforeTool?: () => Promise<void>,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    ...buildTurnEndHooks(),
    ...(beforeTool
      ? {
          PreToolUse: [
            { hooks: [toolGateHook(beforeTool)], timeout: TOOL_GATE_TIMEOUT_S },
          ],
        }
      : {}),
  };
}
