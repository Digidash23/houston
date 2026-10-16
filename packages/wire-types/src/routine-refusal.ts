/**
 * The routine-not-found refusal as the client reads it: the protocol's own
 * code and parser, never a second copy (see `@houston/protocol/routine-refusal`).
 *
 * Erasable-syntax-only re-export, so the app's node:test entry points load it
 * through the `@houston/wire-types/routine-refusal` subpath.
 */
export {
  isRoutineNotFoundBody,
  ROUTINE_NOT_FOUND,
} from "@houston/protocol/routine-refusal";
