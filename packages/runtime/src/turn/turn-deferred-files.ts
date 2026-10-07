import type { PiBackendDeps } from "../backends/pi/backend";
import type { FileSnapshot } from "../session/file-changes";
import { captureWorkspaceSnapshot } from "./turn-session-success";

type TurnTool = PiBackendDeps["customTools"][number];

/**
 * The agent's own files: anything under a non-hidden folder of the agent
 * directory (`workspaces/<ws>/<agent>/<dir>/**`, `<dir>` not starting with
 * `.`). That covers chat attachments (`uploads/`, host turn/attachments.ts)
 * and every document the person or the agent made, which together are most
 * of a large agent's bytes. No runtime input lives there: the prompt and the
 * harness read the agent's root context files (CLAUDE.md, AGENTS.md) and its
 * hidden folders (`.houston/`, `.agents/`, `.claude/`), which stay on the
 * critical path. Only a turn's tools read these files, so a claimed turn
 * hydrates them behind the prompt: the model starts while they download, and
 * every tool, the file-change snapshot and the final sync wait for them. The
 * gateway leaves the same objects out of the turn's inlined prefetch (cloud
 * internal/pooldispatch/prefetch.go), so they never sit on the upload the
 * worker's answer waits for. Keep the two predicates identical.
 */
export function deferredWorkspaceFile(rel: string): boolean {
  const segments = rel.split("/");
  const dir = segments[3];
  return (
    segments.length > 4 &&
    segments[0] === "workspaces" &&
    dir !== undefined &&
    dir !== "" &&
    !dir.startsWith(".")
  );
}

/** Hold a tool until the deferred objects land; a failed download refuses it. */
export async function awaitDeferredFiles(
  ready: Promise<void> | undefined,
  signal?: AbortSignal,
): Promise<void> {
  if (!ready) return;
  const stop = signal ? abortion(signal) : undefined;
  try {
    await (stop ? Promise.race([ready, stop.stopped]) : ready);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The agent's files did not load for this turn (${detail}), so its tools cannot run. Ask the user to send the message again.`,
      { cause: error },
    );
  } finally {
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
    (error: unknown) => {
      // The tools already refuse with this failure; the diff is best-effort.
      console.warn(
        "[turn] file snapshot skipped, deferred uploads failed:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    },
  );
}
