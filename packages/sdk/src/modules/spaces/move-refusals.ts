import { NAME_TAKEN } from "@houston/protocol/file-refusal";

/**
 * The C8 codes an agent move is refused with, from the `POST /move` rejection
 * body or a failed poll's `error`. Each is an expected state with its own
 * authored copy, never a bug to report:
 * - `unsupported_move` (403): this agent cannot go to that space.
 * - `unmovable_volume` (409): its storage cannot be moved automatically yet.
 * - `needs_upgrade` (403): the destination team needs an upgrade first.
 * - `name_taken` (409): the destination team already holds an agent with the
 *   same name key, refused before anything starts.
 */
const MOVE_REFUSAL_CODES = [
  "unsupported_move",
  "unmovable_volume",
  "needs_upgrade",
  NAME_TAKEN,
] as const;

export type MoveRefusalCode = (typeof MOVE_REFUSAL_CODES)[number];

/**
 * A failed move as a surface explains it: one of the C8 refusals, the client's
 * own `timeout` (a poll that outlived its budget), or `unknown`.
 */
export type MoveErrorKind = MoveRefusalCode | "timeout" | "unknown";

/** Whether a move answered with one of the C8 refusal codes. */
export function isMoveRefusalCode(
  code: string | null | undefined,
): code is MoveRefusalCode {
  return (
    MOVE_REFUSAL_CODES as readonly (string | null | undefined)[]
  ).includes(code);
}

/** Map a move's error code (rejection or poll `error`) to its kind. */
export function classifyMoveError(
  code: string | null | undefined,
): MoveErrorKind {
  return isMoveRefusalCode(code) ? code : "unknown";
}

/**
 * Whether trying the same move again can succeed. A storage the gateway cannot
 * move stays unmovable, and a taken name stays taken until the person renames
 * the agent; every other failure may clear on its own.
 */
export function canRetryMoveError(kind: MoveErrorKind): boolean {
  return kind !== "unmovable_volume" && kind !== NAME_TAKEN;
}

/**
 * Whether the gateway refused the move before anything started (C8
 * `name_taken`). No move lock is held, so a client's record of the move to
 * resume is void: re-sending it can only be refused again until the person
 * acts. Every other refusal may leave a lock that only a finished move frees.
 */
export function isMoveRefusedBeforeStart(
  code: string | null | undefined,
): code is typeof NAME_TAKEN {
  return code === NAME_TAKEN;
}
