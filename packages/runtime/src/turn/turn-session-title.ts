import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { startTurnMissionTitle, turnTitleRunner } from "./turn-mission-title";
import type { RunTurnDeps } from "./turn-session-startup";
import type { TurnDirectories, TurnSessionRequest } from "./turn-session-types";

/**
 * A new mission's title starts the moment the reply is complete, overlapping
 * the turn's finishing work, and never on a failed or cancelled turn. Returns
 * the title's finisher, or null when there is nothing to title.
 */
export function startPooledTurnTitle(input: {
  turn: TurnSessionRequest;
  deps: RunTurnDeps;
  directories: TurnDirectories;
  model: { id: string };
  modelRuntime: ModelRuntime;
  failed: boolean;
}): ReturnType<typeof startTurnMissionTitle> | null {
  const { turn, deps, directories } = input;
  if (!turn.missionTitle || input.failed || turn.signal?.aborted) return null;
  return startTurnMissionTitle({
    conversationId: turn.conversationId,
    request: turn.missionTitle,
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
    ...(turn.readRemoteActivity ? { readRemote: turn.readRemoteActivity } : {}),
  });
}
