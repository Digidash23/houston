import { join } from "node:path";
import type { ChatMessage, WireFrame } from "@houston/runtime-client";
import {
  newUsedTokenCapture,
  runWithUsedTokenCapture,
} from "../auth/used-token";
import { framePrompt } from "../session/attribution";
import {
  newInteractionHolder,
  runWithInteractionCapture,
} from "../session/interaction";
import { recordPooledRoutineCarry } from "./turn-routine-context";
import { openTurnBackendSession } from "./turn-session-backend";
import { handleTurnSessionFailure } from "./turn-session-failure";
import { collectTurnFrames, newTurnFrames } from "./turn-session-frames";
import type { RunTurnDeps } from "./turn-session-startup";
import {
  captureWorkspaceSnapshot,
  finishSuccessfulTurn,
} from "./turn-session-success";
import { startPooledTurnTitle } from "./turn-session-title";
import type {
  TurnDirectories,
  TurnOutcome,
  TurnSessionRequest,
} from "./turn-session-types";
import { recordPooledUserTurn } from "./turn-session-user";

/**
 * One pi turn against resolved hydrated directories. Unlike chat.ts (one
 * long-lived process = one workspace, module
 * state), EVERYTHING here is per-request: auth storage, model registry,
 * session, tools. Nothing survives the request — that is the isolation story.
 *
 * Emits user/text/thinking/tool frames via `emit`; the TERMINAL frame is the
 * caller's job (it must sync the workspace back to object storage first, or a
 * client could see `done` before its files are durable).
 */

export type { RunTurnDeps } from "./turn-session-startup";
export type {
  TurnDirectories,
  TurnModelPin,
  TurnOutcome,
  TurnRunner,
  TurnSessionRequest,
} from "./turn-session-types";

export async function runTurn(
  directories: TurnDirectories,
  turn: TurnSessionRequest,
  deps: RunTurnDeps = {},
): Promise<TurnOutcome> {
  const { conversationId, text, provider, signal, pin, mode, turnId, author } =
    turn;
  const emit = (e: WireFrame) => turn.emit({ ...e, turnId });
  const { workspaceDir, dataDir } = directories;
  const conversationsDir = join(dataDir, "conversations");
  const { canonicalMessages, priorAuthors } = recordPooledUserTurn(
    dataDir,
    turn,
    emit,
  );

  const frames = newTurnFrames();
  /**
   * WHICH access token this turn ran on, for the revoked-token report
   * (auth/used-token.ts, PRODUCT-1319). This path's `ModelRuntime` uses pi's
   * OWN file-backed store (not `HoustonAuthStore`), so nothing records at
   * request time — instead the capture is SEEDED from the hydrated per-request
   * auth.json below. That read is exact here: the root is a throwaway copy
   * exclusive to this request, and its served entries are access-only (Gate
   * #2, no refresh token), so no re-serve or refresh can rotate the token
   * between the seed and a failure. Held outside the try so the catch can
   * still name the failed token.
   */
  const usedTokens = newUsedTokenCapture();
  // Set when a routine run starts fresh (turn-routine-context.ts): announced
  // before the prompt and persisted on the reply, like the standing server's.
  let compaction: ChatMessage["compaction"];
  let routineResetBase: number | undefined;
  try {
    const opened = await openTurnBackendSession({
      directories,
      turn,
      deps,
      canonicalMessages,
      usedTokens,
    });
    const { replay, session, model, modelRuntime } = opened;
    compaction = opened.compaction;
    routineResetBase = opened.routineResetBase;
    if (compaction) emit({ type: "context_compacted", data: compaction });

    // Snapshot the hydrated workspace so the turn's created/modified files can
    // be surfaced as a `file_changes` frame. The per-turn root is exclusive to
    // this request, so the diff is attributable by construction. Best-effort.
    const beforeFiles = captureWorkspaceSnapshot(workspaceDir);

    // A fresh per-turn holder for whatever the model ends up waiting on the user
    // for (ask_user); established for the prompt's async subtree so the tool
    // records into it. Read after prompt() resolves, returned on the outcome.
    const interaction = newInteractionHolder();
    const unsubscribe = collectTurnFrames(
      session,
      frames,
      interaction,
      turn.timings,
      emit,
    );
    const onAbort = () => void session.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      // The used-token capture spans the prompt so the streamed error path
      // (pi/wire.ts) reads THIS turn's seeded token when it reports.
      if (turn.timings) turn.timings.t_prompt_start = performance.now();
      await runWithInteractionCapture(interaction, () =>
        runWithUsedTokenCapture(usedTokens, () =>
          session.prompt(
            (replay?.text ?? "") + framePrompt(text, author, priorAuthors),
          ),
        ),
      );
    } finally {
      signal?.removeEventListener("abort", onAbort);
      unsubscribe();
    }
    const finishTitle = startPooledTurnTitle({
      turn,
      deps,
      directories,
      model,
      modelRuntime,
      failed: frames.providerError !== undefined,
    });
    const outcome = finishSuccessfulTurn({
      beforeFiles,
      providerError: frames.providerError,
      workspaceDir,
      mode,
      assistantText: frames.assistantText,
      interaction,
      conversationsDir,
      conversationId,
      tools: frames.tools,
      usage: frames.usage,
      compaction,
      provider,
      turnId,
      emit,
    });
    const missionTitle = await finishTitle?.();
    return missionTitle ? { ...outcome, missionTitle } : outcome;
  } catch (error) {
    return handleTurnSessionFailure({
      error,
      signal,
      providerError: frames.providerError,
      assistantText: frames.assistantText,
      tools: frames.tools,
      usage: frames.usage,
      compaction,
      conversationsDir,
      conversationId,
      turnId,
      provider,
      model: pin?.model,
      text,
      usedTokens,
      emit,
    });
  } finally {
    // A routine run records what it left its session holding, before the
    // caller's sync-back ships the conversation file (turn-routine-context.ts).
    recordPooledRoutineCarry({
      dataDir,
      conversationId,
      turnId,
      resetBaseTokens: routineResetBase,
    });
  }
}
