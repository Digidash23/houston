import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { startTurnMissionTitle, turnTitleRunner } from "./turn-mission-title";
import type { InTreeMissionTitle } from "./turn-mission-title-outcome";
import type { RunTurnDeps } from "./turn-session-startup";
import type { TurnDirectories, TurnSessionRequest } from "./turn-session-types";

/** A new mission's title, overlapping the turn that answers it. */
export interface PooledTurnTitle {
  /** Start the title call. Idempotent; a no-op once abandoned. */
  start(): void;
  /** Drop the title: its turn failed or was cancelled. */
  abandon(): void;
  /**
   * The reply is complete: await the title and write the card (starting it
   * now if nothing did), or abandon it when the turn failed or was cancelled.
   */
  settle(failed: boolean): Promise<InTreeMissionTitle | undefined>;
}

/**
 * Arm a new mission's title, or null when there is nothing to title. The
 * excerpt is the user's own words, never the reply, so the caller starts it
 * when the model's response opens (turn-session.ts): the title call then runs
 * beside the reply instead of after it, and the terminal frame, which carries
 * the follow-up bubbles, no longer waits a whole second model call. Not at
 * the prompt itself: on anthropic the title spawns its own Claude CLI, and
 * booting two at once in a small sandbox would slow the reply's first token.
 */
export function armPooledTurnTitle(input: {
  turn: TurnSessionRequest;
  deps: RunTurnDeps;
  directories: TurnDirectories;
  model: { id: string };
  modelRuntime: ModelRuntime;
}): PooledTurnTitle | null {
  const { turn, deps, directories } = input;
  const request = turn.missionTitle;
  if (!request || turn.signal?.aborted) return null;
  const cancel = new AbortController();
  let finish: (() => Promise<InTreeMissionTitle>) | undefined;
  const start = () => {
    if (finish || cancel.signal.aborted) return;
    finish = startTurnMissionTitle({
      conversationId: turn.conversationId,
      request,
      run:
        deps.titleRunner ??
        turnTitleRunner({
          provider: turn.provider,
          model: input.model,
          modelRuntime: input.modelRuntime,
          directories,
          claudeQuery: deps.claudeSdk?.query,
          claudePlan: turn.claudePlan,
        }),
      workspaceDir: directories.workspaceDir,
      cancel: cancel.signal,
      ...(turn.readRemoteActivity
        ? { readRemote: turn.readRemoteActivity }
        : {}),
    });
  };
  const abandon = () => cancel.abort();
  return {
    start,
    abandon,
    async settle(failed) {
      if (failed || turn.signal?.aborted) {
        abandon();
        return undefined;
      }
      start();
      return finish?.();
    },
  };
}
