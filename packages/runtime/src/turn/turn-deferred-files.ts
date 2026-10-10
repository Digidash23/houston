import { TOOL_GATE_DENY_AFTER_MS } from "../backends/claude/tool-gate-hook";
import type { PiBackendDeps } from "../backends/pi/backend";
import type { FileSnapshot } from "../session/file-changes";
import { captureWorkspaceSnapshot } from "./turn-session-success";

type TurnTool = PiBackendDeps["customTools"][number];

/** A claimed turn hydrates the agent's own files behind the prompt: the
 *  model starts while they download, and every tool, the file-change
 *  snapshot and the final sync wait for them (the rule: turn-deferred-rule.ts). */
export { deferredWorkspaceFile } from "./turn-deferred-rule";

/**
 * Hold a tool until the deferred objects land; a failed download refuses it,
 * and so does the deadline Claude's tool gate uses (tool-gate-hook.ts).
 */
export async function awaitDeferredFiles(
  ready: Promise<void> | undefined,
  signal?: AbortSignal,
  deadlineMs: number = TOOL_GATE_DENY_AFTER_MS,
): Promise<void> {
  if (!ready) return;
  const stop = signal ? abortion(signal) : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("the agent's files are still loading")),
      deadlineMs,
    );
  });
  try {
    await Promise.race([ready, late, ...(stop ? [stop.stopped] : [])]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The agent's files did not load for this turn (${detail}), so its tools cannot run. Ask the user to send the message again.`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
    // pi hands every tool call of a prompt the same signal.
    stop?.dispose();
  }
}

function abortion(signal: AbortSignal) {
  let onAbort: () => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("the turn was stopped"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    stopped,
    dispose: () => signal.removeEventListener("abort", onAbort),
  };
}

/** pi tools that run only once the deferred objects are on disk. */
export function gateTurnTools(
  tools: TurnTool[],
  ready: Promise<void> | undefined,
): TurnTool[] {
  if (!ready) return tools;
  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      await awaitDeferredFiles(ready, signal);
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  }));
}

/**
 * The turn's before-snapshot for its file-change diff, taken once the
 * deferred objects land so they never read as files the turn created. Tools
 * cannot run first: this reaction is registered on `ready` before the prompt
 * starts, and a tool only subscribes to it once the model calls one, so the
 * synchronous capture always precedes every tool's continuation.
 */
export function snapshotWhenReady(
  workspaceDir: string,
  ready: Promise<void> | undefined,
): Promise<FileSnapshot | null> {
  if (!ready) return Promise.resolve(captureWorkspaceSnapshot(workspaceDir));
  return ready.then(
    () => captureWorkspaceSnapshot(workspaceDir),
    // No tool ran (they all wait on `ready`), so there is no diff to take;
    // a failure was already reported once (turn-deferred-watch.ts).
    () => null,
  );
}
