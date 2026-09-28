import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  addressesMission,
  applyActivityUpdate,
  loadActivities,
  saveActivities,
  upsertById,
} from "@houston/domain";
import { readAnthropicToken } from "../backends/claude/read-token";
import type { ClaudeQuery } from "../backends/claude/session";
import { titleWithClaude } from "../backends/claude/title";
import {
  generateMissionTitle,
  type MissionTitleRequest,
  type MissionTitleRunner,
} from "../session/mission-title";
import { oneShotText } from "../session/one-shot";
import { TITLE_PROMPT } from "../session/title-prompt";
import { turnAuthStore } from "./turn-backend";
import { fsTextStore } from "./turn-fs-store";
import type { TurnDirectories } from "./turn-session-types";

/**
 * The per-turn worker's title runner: the turn's OWN provider, model, model
 * runtime and hydrated per-request credential. Same compliance gate as every
 * title: anthropic runs through the Claude Agent SDK on the request's token,
 * never pi's in-process Anthropic client.
 */
export function turnTitleRunner(input: {
  provider: string;
  model: { id: string };
  modelRuntime: ModelRuntime;
  directories: TurnDirectories;
  claudeQuery?: ClaudeQuery;
}): MissionTitleRunner {
  const { workspaceDir, dataDir } = input.directories;
  if (input.provider === "anthropic")
    return (excerpt, signal) =>
      titleWithClaude({
        excerpt,
        titlePrompt: TITLE_PROMPT,
        workspaceDir,
        readToken: () => readAnthropicToken(turnAuthStore(dataDir)),
        dataDir,
        modelId: input.model.id,
        signal,
        ...(input.claudeQuery ? { query: input.claudeQuery } : {}),
      });
  return (excerpt, signal) =>
    oneShotText({
      cwd: workspaceDir,
      model: input.model,
      modelRuntime: input.modelRuntime,
      systemPrompt: TITLE_PROMPT,
      prompt: excerpt,
      signal,
    });
}

/**
 * Title the mission's card in the hydrated tree, BEFORE sync-back, so the write
 * lands with the turn's other writes and `ActivityChanged` ships in the terminal
 * frame's `changed`. Written only while the card still shows the fallback it was
 * created with — a rename the user made meanwhile wins. Resolves true on write.
 */
export async function writeMissionTitleInTree(
  workspaceDir: string,
  conversationId: string,
  title: string,
  fallback: string,
): Promise<boolean> {
  const store = fsTextStore();
  const { items } = await loadActivities(store, workspaceDir);
  const current = items.find((a) => addressesMission(a, conversationId));
  if (!current || current.title !== fallback) return false;
  const next = applyActivityUpdate(
    current,
    { title },
    new Date().toISOString(),
  );
  await saveActivities(store, workspaceDir, upsertById(items, next));
  return true;
}

/**
 * Start the title the moment the reply is complete, so it overlaps the turn's
 * own finishing work (workspace diff, transcript append); the returned `finish`
 * awaits it and writes the card. Never rejects: a failed title or write keeps
 * the fallback and is reported.
 */
export function startTurnMissionTitle(input: {
  conversationId: string;
  request: MissionTitleRequest;
  run: MissionTitleRunner;
  workspaceDir: string;
  timeoutMs?: number;
}): () => Promise<void> {
  const pending = generateMissionTitle(
    input.conversationId,
    input.request,
    input.run,
    input.timeoutMs,
  );
  return async () => {
    const title = await pending;
    if (!title) return;
    try {
      await writeMissionTitleInTree(
        input.workspaceDir,
        input.conversationId,
        title,
        input.request.fallback,
      );
    } catch (err) {
      console.error(
        `[mission-title] card write failed for ${input.conversationId}; keeping the fallback:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  };
}
