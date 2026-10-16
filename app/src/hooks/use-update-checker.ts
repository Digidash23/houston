import { ownTurnInFlight } from "@houston/engine-adapter";
import { useCallback, useEffect, useRef } from "react";
import { currentAppVersion } from "../lib/app-version";
import { showUpdateCheckStuckToast } from "../lib/update-check-toast";
import {
  autoInstallOrigin,
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
  returnAction,
} from "../lib/update-return";
import { useDraftStore } from "../stores/drafts";
import { useInteractionDraftStore } from "../stores/interaction-drafts";
import { useUpdateMachine } from "./use-update-machine";

export type {
  InstallSource,
  UpdateInfo,
  UpdateStatus,
} from "./use-update-machine";

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
 * - the person returns after a long absence (`update-return.ts`) → the pill's
 *   release, or one found right then, installs like a launch find, unless a
 *   turn this device sent, an unsent draft, or a download or install in
 *   flight holds it back. Then the pill stays.
 */
export function useUpdateChecker() {
  const {
    status,
    currentStatus,
    runCheck,
    download,
    installAndRelaunch,
    relaunchInstalledApp,
  } = useUpdateMachine();
  const lastCheckAtRef = useRef<number | null>(null);
  // Consecutive check FAILURES. A client that can never reach the release
  // feed would strand on an old build silently (the check is fail-open) —
  // when the streak first hits the stuck threshold, it surfaces itself:
  // nudge + telemetry, once per streak.
  const failureStreakRef = useRef(0);
  // Where the window stands between away and back. Per mount on purpose: a
  // fresh mount starts in front, so a remount can never arm a return install.
  const absenceRef = useRef<AbsenceState>(initialAbsence(Date.now()));

  const check = useCallback(
    async (returned: boolean) => {
      lastCheckAtRef.current = Date.now();
      const { outcome, message } = await runCheck(returned);
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
    },
    [runCheck],
  );

  /** The return moment. True when it acted (the install or the return check
   *  is under way); false when something in flight held it, so the caller
   *  falls back to its ordinary poll or focus re-check. */
  const tryReturn = useCallback((): boolean => {
    const action = returnAction({
      status: currentStatus(),
      turnInFlight: ownTurnInFlight(),
      draftPending: draftPending(
        useDraftStore.getState().drafts,
        useInteractionDraftStore.getState().parked,
      ),
    });
    if (action === "install") void installAndRelaunch("return");
    else if (action === "check") void check(true);
    return action !== "hold";
  }, [check, currentStatus, installAndRelaunch]);

  // Every entry into "available" acts once: a launch or return find
  // installs, a mid-session find downloads. A failed background download
  // lands in `error`, the next check finds the release again and this
  // re-runs, so a blip retries at poll cadence with no loop of its own.
  // PROD-only: the check effect below never fires in dev, and auto-installing
  // the shipped build over a dev bundle would be hostile — belt and suspenders.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (status.state !== "available") return;
    const auto = autoInstallOrigin(status.info.origin);
    if (auto) void installAndRelaunch(auto);
    else void download("poll");
  }, [status, download, installAndRelaunch]);

  useEffect(() => {
    // The updater pings the production release feed and would offer the
    // shipped build over a local dev build (e.g. `pnpm tauri dev`) — there's
    // nothing sensible to install over a dev bundle, so it just nags. Only
    // run in packaged production builds. (On web the updater is shimmed to a
    // no-op regardless.)
    if (!import.meta.env.PROD) return;
    void check(false);
    const track = (event: AbsenceEvent): boolean => {
      const step = absenceStep(absenceRef.current, event);
      absenceRef.current = step.state;
      return step.returned && tryReturn();
    };
    // The interval tick is also the sleep probe: a tick that lands long
    // after its slot means the machine slept, and the wake is a return.
    const tick = () => {
      if (!track({ kind: "tick", at: Date.now() })) void check(false);
    };
    const interval = setInterval(tick, UPDATE_CHECK_INTERVAL_MS);
    const away = () => {
      track({ kind: "away", at: Date.now() });
    };
    // Returning to the app is a cheap moment to look again, throttled
    // against focus bursts. The link coming back is the moment a download
    // that died on it can carry on: the check finds the release again and
    // the shell resumes from the bytes it kept, instead of waiting out the
    // rest of the poll interval.
    const recheckIfDue = () => {
      if (shouldRecheckOnFocus(lastCheckAtRef.current, Date.now())) {
        void check(false);
      }
    };
    const back = () => {
      if (!track({ kind: "back", at: Date.now() })) recheckIfDue();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") away();
      else back();
    };
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    window.addEventListener("online", recheckIfDue);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
      window.removeEventListener("online", recheckIfDue);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [check, tryReturn]);

  return { status, installAndRelaunch, relaunchInstalledApp };
}
