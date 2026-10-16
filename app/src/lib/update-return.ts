import { UPDATE_CHECK_INTERVAL_MS } from "./update-policy";
import type { UpdateStatus } from "./update-status";

/**
 * The return moment (`update-policy.ts`, third bullet): when a long absence
 * ends, and what the updater may do then. Pure: `useUpdateChecker` feeds it
 * window events and timer ticks and reads one decision back, so the rules
 * are pinned by tests, not by leaving a laptop closed overnight.
 */

/** How long the window must be away before coming back counts as a return.
 *  Longer than a lunch or a meeting (the person is still mid-task after
 *  those), shorter than a night or a weekend, the absences the stale fleet
 *  showed. Every absence is judged against this, a sleep included. */
export const LONG_ABSENCE_MS = 4 * 60 * 60 * 1000;

/** How late the check-interval tick must land to prove that timers did not
 *  run: a tick due every UPDATE_CHECK_INTERVAL_MS that arrives this much
 *  past its slot means the machine slept or the webview was suspended. The
 *  gap only dates an absence from the last tick before it; the 4h rule then
 *  judges that absence like any other, so what caused the gap, or a webview
 *  throttle that somehow delayed a tick this much, never installs anything
 *  by itself. */
export const SLEEP_GAP_MS = 10 * 60 * 1000;

export interface AbsenceState {
  /** When the window went away (blur, hidden, or the last tick before a
   *  gap), or null while the person is here. */
  awaySince: number | null;
  /** The last check-interval tick, or the last absence that ended: a gap in
   *  the timers is measured from here. */
  lastTickAt: number;
}

/** A mount starts in front with no absence behind it, whatever the process
 *  saw before: a remount can never arm a return install, only an absence
 *  this mount watched end can. */
export function initialAbsence(now: number): AbsenceState {
  return { awaySince: null, lastTickAt: now };
}

/** The window events the tracker reads, named as the DOM fires them. Which
 *  of them start an absence and which one ends it is the policy below. */
export type AbsenceEvent =
  | { kind: "blur"; at: number }
  | { kind: "hidden"; at: number }
  | { kind: "visible"; at: number }
  | { kind: "focus"; at: number }
  /** The check interval fired; `focused` is `document.hasFocus()` then. */
  | { kind: "tick"; at: number; focused: boolean };

export interface AbsenceStep {
  state: AbsenceState;
  /** This event ends an absence of LONG_ABSENCE_MS or more. */
  returned: boolean;
}

/** One event through the tracker. The return signal is the window's focus:
 *  a document turning visible is another window moving off Houston's, with
 *  no person behind it. A return is reported once per absence and consumed
 *  on the spot. */
export function absenceStep(
  state: AbsenceState,
  event: AbsenceEvent,
): AbsenceStep {
  switch (event.kind) {
    case "blur":
    case "hidden":
      return { state: away(state, event.at), returned: false };
    case "visible":
      return { state, returned: false };
    case "focus":
      return comeBack(state, event.at);
    case "tick": {
      const gap = event.at - state.lastTickAt - UPDATE_CHECK_INTERVAL_MS;
      if (gap < SLEEP_GAP_MS) {
        // Timers ran, so a window focused now has a person in front of it:
        // an absence no focus event closed is forgotten, never judged late.
        const awaySince = event.focused ? null : state.awaySince;
        return { state: { awaySince, lastTickAt: event.at }, returned: false };
      }
      // Timers did not run: the person has been away since the last tick
      // at the latest. With the window focused no focus event will follow,
      // so this tick is the return; otherwise the next focus is.
      const slept = away(state, state.lastTickAt);
      return event.focused
        ? comeBack(slept, event.at)
        : { state: { ...slept, lastTickAt: event.at }, returned: false };
    }
  }
}

/** The earliest goodbye starts the clock; a later one keeps it. */
function away(state: AbsenceState, at: number): AbsenceState {
  const awaySince =
    state.awaySince === null ? at : Math.min(state.awaySince, at);
  return { ...state, awaySince };
}

/** Judge the absence that ends now and consume it: both clocks restart
 *  here, so a late tick after a focus cannot report the same absence twice. */
function comeBack(state: AbsenceState, at: number): AbsenceStep {
  if (state.awaySince === null) return { state, returned: false };
  return {
    state: { awaySince: null, lastTickAt: at },
    returned: at - state.awaySince >= LONG_ABSENCE_MS,
  };
}

export interface ReturnInputs {
  status: UpdateStatus;
  /** This build talks to a remote engine (`isRemoteEngine`), so a relaunch
   *  kills nothing but this window. */
  engineRemote: boolean;
  /** A turn this device sent is still out (`ownTurnInFlight`). */
  turnInFlight: boolean;
  /** A composer holds unsent words or files, or a card is half-walked. */
  draftPending: boolean;
}

/** Why a staged release was not installed at a return. */
export type ReturnHoldReason = "turn" | "draft" | "busy";

/** What a return does: install the release a poll already staged, hold it
 *  (the pill stays) because something the person could lose is in flight or
 *  the updater is mid-step, or nothing beyond the ordinary background check,
 *  whose find waits for the next return. */
export type ReturnAction =
  | { kind: "install" }
  | { kind: "hold"; reason: ReturnHoldReason }
  | { kind: "check" };

export function returnAction({
  status,
  engineRemote,
  turnInFlight,
  draftPending,
}: ReturnInputs): ReturnAction {
  if (!engineRemote) return { kind: "check" };
  if (status.state === "downloading" || status.state === "installing") {
    return { kind: "hold", reason: "busy" };
  }
  if (status.state !== "downloaded") return { kind: "check" };
  if (turnInFlight) return { kind: "hold", reason: "turn" };
  if (draftPending) return { kind: "hold", reason: "draft" };
  return { kind: "install" };
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
