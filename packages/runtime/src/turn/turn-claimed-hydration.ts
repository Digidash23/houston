import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { startTurnFilesystem } from "./turn-filesystem";
import { ownConversationOnly } from "./turn-hot-set";
import type { TurnRequest } from "./types";

/**
 * Store objects no claimed turn path reads or owns for writeback. Exclusions
 * never enter the hydration manifest, so their absence cannot become a delete.
 */
const CLAIMED_TURN_EXCLUDES = [
  "workspaces/*/*/.houston/runtime/runtime.log",
  "claude-login/",
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
        }
      : {}),
    timings: input.timings,
  });
}
