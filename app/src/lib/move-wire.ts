import type { MoveWire } from "./move-resume";
import { isExpectedMoveAnswer } from "./share-via-team";
import { tauriOrg } from "./tauri";

/**
 * The move wire every driver that owns its own surface binds: the team move
 * dialog and both boot-time healers. `toast: false` on both calls, because a
 * transient poll blip is retried and a terminal outcome gets ONE authored toast
 * or face from the driver. An unexpected failure is still logged and captured;
 * an expected answer ({@link isExpectedMoveAnswer}) skips capture too.
 */
export const moveWire: MoveWire = {
  moveAgent: (agentId, toSlug) =>
    tauriOrg.moveAgent(agentId, toSlug, {
      toast: false,
      silence: isExpectedMoveAnswer,
    }),
  moveStatus: (agentId, moveId) =>
    tauriOrg.moveStatus(agentId, moveId, { toast: false }),
};
