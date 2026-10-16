import { ownTurnInFlight } from "@houston/engine-adapter";
import { useCallback, useEffect, useRef } from "react";
import { analytics } from "../lib/analytics";
import { currentAppVersion } from "../lib/app-version";
import { isRemoteEngine } from "../lib/engine";
import { showUpdateCheckStuckToast } from "../lib/update-check-toast";
import {
  nextCheckFailureStreak,
  shouldRecheckOnFocus,
  UPDATE_CHECK_INTERVAL_MS,
  updateCheckJustStuck,
} from "../lib/update-policy";
import {
  type AbsenceEvent,
  type AbsenceState,
  absenceStep,
  draftPending,
  initialAbsence,
  type ReturnInputs,
  returnAction,
  returnLossHold,
  windowInFront,
} from "../lib/update-return";
import { useDraftStore } from "../stores/drafts";
import { useInteractionDraftStore } from "../stores/interaction-drafts";
import { useUpdateMachine } from "./use-update-machine";

export type {
  InstallSource,
  UpdateInfo,
  UpdateStatus,
} from "./use-update-machine";

/** What the person could lose to a relaunch right now, read live: a turn
 *  this device sent, or a composer's unsent words, files or half-walked
 *  card. Read at the return and again right before the install. */
function lossGates(): Pick<ReturnInputs, "turnInFlight" | "draftPending"> {
  return {
    turnInFlight: ownTurnInFlight(),
    draftPending: draftPending(
      useDraftStore.getState().drafts,
      useInteractionDraftStore.getState().parked,
    ),
  };
}
const returnHold = () => returnLossHold(lossGates());

/**
 * Update policy. The machine (use-update-machine) knows HOW to download and
 * install; this hook decides WHEN: a launch check plus a short interval plus
 * a focus re-check, and what a find does (`update-policy.ts`):
 *
 * - found by the launch check → install and relaunch right away (nothing is
 *   running yet; the overlay covers the few seconds it takes),
 * - found mid-session → download silently. The restart pill then waits for
 *   the user's own click, so a running turn or a half-typed message can't
 *   be killed by an update,
 * - the person returns after a long absence (`update-return.ts`) → the
 *   release the pill holds installs at once, like a launch find, where the
 *   engine is remote and nothing this device could lose is in flight. A
 *   return never checks on its own: with nothing staged it runs the ordinary
 *   background check, and that find waits for the next return.
 */
export function useUpdateChecker() {
  const {
    status,
    currentStatus,
    runCheck,
    download,
    installAndRelaunch,
    relaunchInstalledApp,
  } = useUpdateMachine({ returnHold });
  const lastCheckAtRef = useRef<number | null>(null);
  // Consecutive check FAILURES. A client that can never reach the release
  // feed would strand on an old build silently (the check is fail-open) —
  // when the streak first hits the stuck threshold, it surfaces itself:
  // nudge + telemetry, once per streak.
  const failureStreakRef = useRef(0);
  // Where the window stands between away and back. Per mount on purpose: a
  // fresh mount starts in front, so a remount can never arm a return install.
  const absenceRef = useRef<AbsenceState>(initialAbsence(Date.now()));

  const check = useCallback(async () => {
    lastCheckAtRef.current = Date.now();
    const { outcome, message } = await runCheck();
    failureStreakRef.current = nextCheckFailureStreak(
      failureStreakRef.current,
      outcome,
    );
    if (updateCheckJustStuck(failureStreakRef.current)) {
      showUpdateCheckStuckToast(
        message ?? "unknown check failure",
        failureStreakRef.current,
        currentAppVersion(),
      );
    }
  }, [runCheck]);

  /** The return moment: install what a poll staged, say why it was held,
   *  or run the ordinary check. */
  const onReturn = useCallback(() => {
    const action = returnAction({
      status: currentStatus(),
      engineRemote: isRemoteEngine(),
      ...lossGates(),
    });
    if (action.kind === "install") void installAndRelaunch("return");
    else if (action.kind === "hold") {
      analytics.track("update_return_held", { reason: action.reason });
    } else void check();
  }, [check, currentStatus, installAndRelaunch]);

  // Every entry into "available" acts once: a launch find installs, a
  // mid-session find downloads. A failed background download lands in
  // `error`, the next check finds the release again and this re-runs, so a
  // blip retries at poll cadence with no loop of its own. PROD-only: the
  // check effect below never fires in dev, and auto-installing the shipped
  // build over a dev bundle would be hostile — belt and suspenders.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (status.state !== "available") return;
    if (status.info.origin === "launch") void installAndRelaunch("launch");
    else void download("poll");
  }, [status, download, installAndRelaunch]);

  useEffect(() => {
    // The updater pings the production release feed and would offer the
    // shipped build over a local dev build (e.g. `pnpm tauri dev`) — there's
    // nothing sensible to install over a dev bundle, so it just nags. Only
    // run in packaged production builds. (On web the updater is shimmed to a
    // no-op regardless.)
    if (!import.meta.env.PROD) return;
    void check();
    // Window events and the interval tick feed the absence tracker. The one
    // that ends a long absence is the return; every other keeps its own job.
    const track = (event: AbsenceEvent): boolean => {
      const step = absenceStep(absenceRef.current, event);
      absenceRef.current = step.state;
      if (step.returned) onReturn();
      return step.returned;
    };
    const tick = () => {
      const event: AbsenceEvent = {
        kind: "tick",
        at: Date.now(),
        focused: windowInFront(document),
      };
      if (!track(event)) void check();
    };
    const interval = setInterval(tick, UPDATE_CHECK_INTERVAL_MS);
    // Returning to the app is a cheap moment to look again, throttled
    // against focus bursts. The link coming back is the moment a download
    // that died on it can carry on: the check finds the release again and
    // the shell resumes from the bytes it kept, instead of waiting out the
    // rest of the poll interval.
    const recheckIfDue = () => {
      if (shouldRecheckOnFocus(lastCheckAtRef.current, Date.now())) {
        void check();
      }
    };
    const focus = () => {
      if (!track({ kind: "focus", at: Date.now() })) recheckIfDue();
    };
    const blur = () => {
      track({ kind: "blur", at: Date.now() });
    };
    const visibility = () => {
      const at = Date.now();
      track(
        document.visibilityState === "hidden"
          ? { kind: "hidden", at }
          : { kind: "visible", at, focused: windowInFront(document) },
      );
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    window.addEventListener("online", recheckIfDue);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", recheckIfDue);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [check, onReturn]);

  return { status, installAndRelaunch, relaunchInstalledApp };
}
