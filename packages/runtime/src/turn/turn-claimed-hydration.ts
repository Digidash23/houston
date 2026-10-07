import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { deferredUpload } from "./turn-deferred-uploads";
import { startTurnFilesystem } from "./turn-filesystem";
import { ownClaudeFlagsOnly, ownConversationOnly } from "./turn-hot-set";
import type { TurnRequest } from "./types";

/**
 * Store objects no claimed turn path reads or owns for writeback. Exclusions
 * never enter the hydration manifest, so their absence cannot become a delete.
 */
const CLAIMED_TURN_EXCLUDES = [
  "workspaces/*/*/.houston/runtime/runtime.log",
  "claude-login/",
  // Houston's approval records: read and written only through their own
  // generation-guarded path (turn-approvals.ts), never by the bulk hydrate.
  "workspaces/*/*/.houston/runtime/sessions/*/assistant-approvals.json",
  "data/sessions/*/assistant-approvals.json",
];

/** Start hydration with the claimed conversation's read and ownership scope. */
export function startTurnRequestFilesystem(input: {
  store: ObjectStore;
  prefix: string;
  root: string;
  turn: Pick<TurnRequest, "claim" | "conversationId" | "actingAs">;
  maxBytes?: number;
  timings: Record<string, number>;
}) {
  const claimed = Boolean(input.turn.claim);
  return startTurnFilesystem({
    store: input.store,
    prefix: input.prefix,
    root: input.root,
    claimed,
    ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
    ...(claimed
      ? {
          filter: ownConversationOnly(
            input.turn.conversationId,
            input.turn.actingAs?.userId,
          ),
          excludes: CLAIMED_TURN_EXCLUDES,
          defer: deferredUpload,
        }
      : { filter: ownClaudeFlagsOnly(input.turn.actingAs?.userId) }),
    timings: input.timings,
  });
}
