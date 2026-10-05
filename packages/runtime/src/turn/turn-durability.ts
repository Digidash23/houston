import { StoreFencedError } from "@houston/runtime-client/object-sync";
import type { ClaimHeartbeat } from "./claim-heartbeat";
import type { TurnServerDeps } from "./server-types";
import { activityDocStale } from "./turn-activity-doc";
import { publishTurnActivityDoc } from "./turn-board-doc";
import { changedEventTypes } from "./turn-changed-events";
import { publishLandedFamilyDocs } from "./turn-family-docs";
import { syncTurnFilesystem, type TurnFilesystem } from "./turn-filesystem";
import type { TurnSandboxViews } from "./turn-sandbox";
import type { TurnOutcome } from "./turn-session";
import type { ResolvedTurnStore } from "./turn-store";
import { type TurnSyncReport, turnSyncReport } from "./turn-sync-report";
import type {
  TranscriptPublishResult,
  TurnTranscript,
} from "./turn-transcript";
import { publishTurnViews } from "./turn-view-publish";
import type { TurnRequest } from "./types";

interface TurnDurabilityOptions {
  deps: TurnServerDeps;
  turn: TurnRequest & { turnId: string };
  filesystem: TurnFilesystem;
  resolved: ResolvedTurnStore;
  heartbeat: ClaimHeartbeat | null;
  outcome: TurnOutcome;
  /** The turn's transcript publisher (created at turn start; null = none). */
  transcript: TurnTranscript | null;
  views?: TurnSandboxViews;
  /**
   * Runs once the sync-back finished, before any doc projects, with the keys
   * it landed: a write that must read what the sync-back merged (the routine
   * auto-pause). Resolves to an error to append to the outcome.
   */
  afterSync?: (landed: readonly string[]) => Promise<string | undefined>;
}

export interface TurnDurabilityResult {
  outcome: TurnOutcome;
  poolWritesOutOfScope: number;
  /** Domain events the landed writes imply (the gateway fans them out). */
  changed: ReturnType<typeof changedEventTypes>;
  /** Set when transcript rows were deliberately not published. */
  transcriptSkipped?: "route_absent";
  /** Set when the activity doc route is absent on an older deployment. */
  activityDocSkipped?: "route_absent";
  /** What sync-back landed; absent when it never completed a pass. */
  sync?: TurnSyncReport;
}

/** A fenced worker no longer owns the conversation: nothing it did is done. */
const claimFenced = (
  poolWritesOutOfScope = 0,
  changed: TurnDurabilityResult["changed"] = [],
  sync?: TurnSyncReport,
): TurnDurabilityResult => ({
  outcome: { error: "claim_fenced" },
  poolWritesOutOfScope,
  changed,
  ...(sync ? { sync } : {}),
});

function appendError(outcome: TurnOutcome, error: string): TurnOutcome {
  return { error: outcome.error ? `${outcome.error}; ${error}` : error };
}

/** Make claimed-turn state durable before the caller emits a terminal frame. */
export async function finishTurnDurability(
  opts: TurnDurabilityOptions,
): Promise<TurnDurabilityResult> {
  await opts.heartbeat?.checkpoint();
  if (opts.heartbeat?.fenced) {
    return claimFenced();
  }

  let synced: Awaited<ReturnType<typeof syncTurnFilesystem>>;
  try {
    // Failed provider work may still have durable tool writes. Only a fence
    // may skip sync because a fenced worker no longer owns this conversation.
    synced = await syncTurnFilesystem({
      store: opts.resolved.store,
      prefix: opts.resolved.prefix,
      filesystem: opts.filesystem,
      conversationId: opts.turn.conversationId,
      claimed: Boolean(opts.turn.claim),
    });
  } catch (error) {
    // A fenced object write means the claim was adopted mid-sync: report it
    // as exactly that, not as a generic sync failure.
    if (error instanceof StoreFencedError) {
      return claimFenced();
    }
    const message = error instanceof Error ? error.message : String(error);
    const failure = opts.outcome.error
      ? `sync failed: ${message}`
      : `workspace sync failed: ${message}`;
    return {
      outcome: appendError(opts.outcome, failure),
      poolWritesOutOfScope: 0,
      changed: [],
    };
  }
  const poolWritesOutOfScope = synced.outOfScope;
  const sync = turnSyncReport(synced, opts.filesystem.workspaceRel);
  let outcome = opts.outcome;
  const afterSyncError = await opts.afterSync?.(synced.uploaded);
  if (afterSyncError) outcome = appendError(outcome, afterSyncError);
  let changed = changedEventTypes(opts.filesystem, [
    ...synced.uploaded,
    ...synced.deleted,
    ...opts.filesystem.immediateWrites,
  ]);

  // The object copy must land first. Otherwise history fallback could expose
  // transcript rows whose authoritative conversation file is still missing.
  let published: TranscriptPublishResult | undefined;
  try {
    published = await opts.transcript?.publish();
  } catch (error) {
    published = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (published && "fenced" in published) {
    return claimFenced(poolWritesOutOfScope, changed, sync);
  }
  // An event is a promise that the refetch can be served asleep: a family
  // whose projection failed is left out (the read would fall to the pod).
  const without = (type: (typeof changed)[number]) => {
    changed = changed.filter((t) => t !== type);
  };
  if (published && "error" in published) {
    outcome = appendError(
      outcome,
      `transcript publish failed: ${published.error}`,
    );
    without("ConversationsChanged");
  }
  const staleViews = await publishTurnViews({
    deps: opts.deps,
    turn: opts.turn,
    filesystem: opts.filesystem,
    views: opts.views,
    source: opts.resolved,
    landed: [...synced.uploaded, ...synced.deleted],
  });
  for (const type of staleViews) without(type);

  const activityPublished =
    opts.turn.claim && sync.board.landed
      ? await publishTurnActivityDoc(
          opts.deps,
          opts.turn,
          opts.filesystem,
          opts.resolved,
        )
      : null;
  if (activityPublished && "error" in activityPublished) {
    outcome = appendError(
      outcome,
      `board doc publish failed: ${activityPublished.error}`,
    );
  }
  if (activityDocStale(activityPublished)) without("ActivityChanged");
  const familyDocs = await publishLandedFamilyDocs({
    deps: opts.deps,
    turn: opts.turn,
    filesystem: opts.filesystem,
    source: opts.resolved,
    landed: [...synced.uploaded, ...opts.filesystem.immediateWrites],
    deleted: synced.deleted,
  });
  for (const error of familyDocs.errors) outcome = appendError(outcome, error);
  for (const type of familyDocs.stale) without(type);
  // The claim may have been adopted while sync/publish were in flight (the
  // heartbeat loop learns it asynchronously). A last checkpoint keeps a stale
  // worker from ever announcing a clean done.
  await opts.heartbeat?.checkpoint();
  if (opts.heartbeat?.fenced) {
    return claimFenced(poolWritesOutOfScope, changed, sync);
  }
  return {
    outcome,
    poolWritesOutOfScope,
    changed,
    sync,
    ...(published && "disabled" in published
      ? { transcriptSkipped: published.reason }
      : {}),
    ...(activityPublished && "disabled" in activityPublished
      ? { activityDocSkipped: activityPublished.reason }
      : {}),
  };
}
