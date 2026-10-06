import type { PiBackendDeps } from "../backends/pi/backend";
import type { FileSnapshot } from "../session/file-changes";
import { captureWorkspaceSnapshot } from "./turn-session-success";

type TurnTool = PiBackendDeps["customTools"][number];

/**
 * Chat attachments (`<agent>/uploads/**`, host turn/attachments.ts) are
 * permanent agent context: every file ever dropped on a chat stays, readable
 * from any later conversation, and most are images that do not compress.
 * Only a turn's tools read them, so a claimed turn hydrates them behind the
 * prompt: the model starts while they download, and every tool waits for
 * them. The gateway leaves the same objects out of the turn's inlined
 * prefetch (cloud internal/pooldispatch/prefetch.go), so they never sit on
 * the upload the first token waits for.
 */
export function deferredUpload(rel: string): boolean {
  const segments = rel.split("/");
  return (
    segments.length > 4 &&
    segments[0] === "workspaces" &&
    segments[3] === "uploads"
  );
}

/** Hold a tool until the deferred objects land; a failed download refuses it. */
export async function awaitDeferredUploads(
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
      `The agent's uploaded files did not load for this turn (${detail}), so its tools cannot run. Ask the user to send the message again.`,
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
      await awaitDeferredUploads(ready, signal);
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
