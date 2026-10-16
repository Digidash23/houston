import { UPDATE_CHECK_INTERVAL_MS } from "./update-policy";
import type { UpdateStatus } from "./update-status";

/**
 * The return moment (`update-policy.ts`, third bullet): when a long absence
 * ends, and what the updater may do then. Pure: `useUpdateChecker` feeds it
 * window events and timer ticks and reads one decision back, so the rules
 * are pinned by tests, not by leaving a laptop closed overnight.
 */

/** How long the window must be hidden or unfocused before coming back counts
 *  as a return. Longer than a lunch or a meeting (the person is still
 *  mid-task after those), shorter than a night or a weekend, the absences the
 *  stale fleet showed. */
export const LONG_ABSENCE_MS = 4 * 60 * 60 * 1000;

/** How late the check-interval tick must land to mean the machine slept:
 *  timers do not run during sleep, so a tick due every
 *  UPDATE_CHECK_INTERVAL_MS that arrives this much past its slot proves a
 *  gap. Wide enough that a throttled hidden webview never passes for one. */
export const SLEEP_GAP_MS = 10 * 60 * 1000;

export interface AbsenceState {
  /** When the window went away (blur or hidden), or null while in front. */
  awaySince: number | null;
  /** The machine slept during the current absence. */
  sleptAway: boolean;
  lastTickAt: number;
}

/** A mount starts in front with no absence behind it, whatever the process
 *  saw before: a remount can never arm a return install, only an absence
 *  this mount watched end can. */
export function initialAbsence(now: number): AbsenceState {
  return { awaySince: null, sleptAway: false, lastTickAt: now };
}

export type AbsenceEvent =
  /** The window blurred or went hidden. */
  | { kind: "away"; at: number }
  /** The window is focused or visible again. */
  | { kind: "back"; at: number }
  /** The check interval fired. */
  | { kind: "tick"; at: number };

export interface AbsenceStep {
  state: AbsenceState;
  /** This event is a return after a long absence. */
  returned: boolean;
}

/** One event through the tracker. A return fires once per absence: the
 *  state is reset the moment it is reported. */
export function absenceStep(
  state: AbsenceState,
  event: AbsenceEvent,
): AbsenceStep {
  switch (event.kind) {
    case "away":
      // The first goodbye starts the clock; a hide after a blur keeps it.
      return {
        state:
          state.awaySince === null ? { ...state, awaySince: event.at } : state,
        returned: false,
      };
    case "back": {
      if (state.awaySince === null) return { state, returned: false };
      const long = event.at - state.awaySince >= LONG_ABSENCE_MS;
      return {
        state: { ...state, awaySince: null, sleptAway: false },
        returned: long || state.sleptAway,
      };
    }
    case "tick": {
      const late = event.at - state.lastTickAt - UPDATE_CHECK_INTERVAL_MS;
      const next = { ...state, lastTickAt: event.at };
      if (late < SLEEP_GAP_MS) return { state: next, returned: false };
      // Woke with the window away: the person is not back yet, their next
      // focus is the return.
      if (state.awaySince !== null) {
        return { state: { ...next, sleptAway: true }, returned: false };
      }
      return { state: next, returned: true };
    }
  }
}

export interface ReturnInputs {
  status: UpdateStatus;
  /** A turn this device sent is still out (`ownTurnInFlight`). */
  turnInFlight: boolean;
  /** A composer holds unsent words or files, or a card is half-walked. */
  draftPending: boolean;
}

/** What a return does: install the release a poll already fetched, run a
 *  check with return semantics, or hold (the pill stays) because something
 *  the person could lose is in flight or the updater is mid-step. */
export type ReturnAction = "install" | "check" | "hold";

export function returnAction({
  status,
  turnInFlight,
  draftPending,
}: ReturnInputs): ReturnAction {
  if (turnInFlight || draftPending) return "hold";
  if (status.state === "downloading" || status.state === "installing") {
    return "hold";
  }
  return status.state === "downloaded" ? "install" : "check";
}

/** Whether any composer holds unsent words or files, or any in-chat card is
 *  half-walked: both live only in memory and die with a relaunch. */
export function draftPending(
  drafts: Record<string, { text: string; files: readonly unknown[] }>,
  parked: Record<string, unknown>,
): boolean {
  if (Object.keys(parked).length > 0) return true;
  return Object.values(drafts).some(
    (draft) => draft.text.trim() !== "" || draft.files.length > 0,
  );
}
