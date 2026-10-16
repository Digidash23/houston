import type { UpdateStatus } from "./update-status";

/**
 * Update policy model (pure logic; `useUpdateChecker` + the surfaces consume it).
 *
 * A release is never installed out from under a working user. The updater
 * finds a release in one of two moments, and the moment decides the shape:
 *
 * - `launch` — the launch check found it. Nothing is running yet, so the
 *   install runs right away behind a calm "upgrading Houston" overlay and the
 *   app relaunches into the new version. This is what keeps the fleet fresh:
 *   every update lands on the next app open at the latest. The launch check
 *   is the first check of the app PROCESS (`update-launch-claim.ts`), never
 *   the first check of a hook mount: React remounts the updater with
 *   `<App/>` on every identity change, and that must not re-arm it.
 * - `poll` — a background re-check found it mid-session. The release
 *   downloads silently; nothing is shown until it is on disk. Then a small
 *   "Restart to update" pill sits in the window corner and the user restarts
 *   whenever they like. No countdown, no modal: a turn in flight, a draft
 *   being typed, a co-located engine mid-task, none of it can be killed by
 *   the updater. One moment besides the pill's click installs that release:
 * - `return` — the person came back after a long absence (`update-return.ts`):
 *   the window was unfocused for hours, or the machine slept that long. The
 *   desktop app is rarely quit (macOS keeps it running, laptops sleep and
 *   wake), so a poll's download would otherwise sit on the pill for weeks.
 *   A return installs the release a poll already STAGED, synchronously at
 *   the moment its gates pass (no turn this device sent, no unsent composer
 *   words or half-walked card, the updater not mid-step). It never runs a
 *   check of its own, so nothing the person starts meanwhile can be overtaken
 *   by a find: a return with nothing staged runs the ordinary background
 *   check, and that find waits for the next return. Remote engines only
 *   (`isRemoteEngine`): on the local-engine build a relaunch kills the
 *   bundled host sidecar, with its routine runs and the turns other clients
 *   sent, which `ownTurnInFlight` cannot see. There the pill stays the only
 *   mid-session install. On a remote-engine build the relaunch still kills
 *   the in-process local-model bridge (`app/src-tauri/src/local_bridge`)
 *   and drops any turn it is relaying, for this person or a teammate sharing
 *   it, exactly as the pill's click and the launch install do. The bridge
 *   exposes no in-flight relay count, and holding on "connected" would stop
 *   every bridge user from updating, so no gate reads it. `return` is never
 *   a find: a release's info carries it only on the statuses of a return's
 *   install.
 *
 * Detection stays pull-based: the Tauri updater polls the release feed's
 * manifest. There is no push channel to a desktop build, and no server-side
 * backstop either (the hosted gateway's 426 min-version floor was retired),
 * so freshness comes from cadence: a launch check, a short interval, and a
 * re-check when the window regains focus. That makes a client whose checks
 * keep FAILING (a proxy or region block between it and the release feed)
 * invisible and permanently stale, so consecutive check failures are counted
 * here and a stuck client surfaces itself: telemetry plus one visible "get it
 * manually" nudge per run.
 */

/** The moment a check runs in: the process's one launch check, or a
 *  background poll (`update-launch-claim.ts` hands it out). */
export type CheckOrigin = "launch" | "poll";

/** What a release's info carries: the check that found it, or `return` on
 *  the statuses of a return's install. */
export type UpdateOrigin = CheckOrigin | "return";

/** How a release is presented: the launch overlay, or the silent background
 *  download that ends in the restart pill. */
export type UpdatePresentation = "launch" | "background";

/** Background re-check cadence. Short enough that an active user has the
 *  release downloaded within minutes of publish; long enough not to hammer
 *  the release feed from every install all day. */
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Minimum gap before a window-focus re-check fires — focus events come in
 *  bursts (Cmd-Tab flurries) and must not turn into a request storm. */
export const FOCUS_RECHECK_MIN_GAP_MS = 60 * 1000;

/** Which presentation a release gets, from where it was found and where it
 *  stands. A launch find runs behind the overlay throughout; a poll find
 *  stays in the background. A return's install runs behind the overlay like
 *  a launch, but its error goes to the pill: the overlay cannot be dismissed,
 *  and the person it would cover has a working app under it. */
export function updatePresentation(
  status: Exclude<UpdateStatus, { state: "idle" }>,
): UpdatePresentation {
  if (status.info.origin === "poll") return "background";
  if (status.info.origin === "return" && status.state === "error") {
    return "background";
  }
  return "launch";
}

/** True when a focus-triggered re-check is due. */
export function shouldRecheckOnFocus(
  lastCheckAt: number | null,
  now: number,
): boolean {
  return lastCheckAt === null || now - lastCheckAt >= FOCUS_RECHECK_MIN_GAP_MS;
}

/** What one update check produced, as the failure counter sees it. `skipped`
 *  covers checks that never ran (a download or install already in flight,
 *  or a release already on disk waiting for its restart) — no signal in
 *  either direction. */
export type UpdateCheckOutcome = "found" | "none" | "failed" | "skipped";

/** Consecutive failures before a client counts as stuck: the launch check
 *  plus two interval polls, ~10 minutes into a session. One offline blip
 *  never trips it; a proxy that blocks the release feed always does. */
export const UPDATE_CHECK_STUCK_THRESHOLD = 3;

/** The failure-streak transition: any completed check resets it, a failure
 *  extends it, a skipped check leaves it alone. */
export function nextCheckFailureStreak(
  streak: number,
  outcome: UpdateCheckOutcome,
): number {
  if (outcome === "failed") return streak + 1;
  if (outcome === "skipped") return streak;
  return 0;
}

/** True the moment a failure streak first reaches the stuck threshold —
 *  exactly once per streak, so a stuck client surfaces once per run instead
 *  of once per poll. */
export function updateCheckJustStuck(streak: number): boolean {
  return streak === UPDATE_CHECK_STUCK_THRESHOLD;
}

/**
 * A background download that fails is retried by the next check (the
 * release feed answers "found" again and the download re-runs), which means a
 * client stuck behind a proxy would file the same failure every poll for the
 * whole session. Report it once per release version: the first failure for a
 * version is the signal, the repeats are noise.
 */
export function shouldReportDownloadFailure(
  reportedVersion: string | null,
  version: string,
): boolean {
  return reportedVersion !== version;
}

/** Attempts one download call makes before leaving the rest to the next
 *  poll (the shell keeps the partial either way). A download behind the
 *  overlay holds the user, so it gets the first request and one resume; a
 *  background poll can afford the shell's whole ladder. */
export const LAUNCH_DOWNLOAD_ATTEMPTS = 2;
export const POLL_DOWNLOAD_ATTEMPTS = 5;

export function downloadAttemptBudget(origin: UpdateOrigin): number {
  return origin === "poll" ? POLL_DOWNLOAD_ATTEMPTS : LAUNCH_DOWNLOAD_ATTEMPTS;
}

/** What asked for a download: the launch find or a background poll (both
 *  automatic), or the person's own retry. A return never downloads: it
 *  installs only what a poll already staged. */
export type DownloadTrigger = CheckOrigin | "user";

/**
 * A download the disk refused is not retried AUTOMATICALLY for that release
 * in this session: every poll would fill the disk again, fail again, and
 * free it again. The person's own retry always runs: someone who just freed
 * space and clicked Retry on the launch overlay (which nothing else
 * dismisses) must not be told nothing. The next release, or the next app
 * start, tries afresh either way.
 */
export function shouldSkipDownload(
  gaveUpVersion: string | null,
  version: string,
  trigger: DownloadTrigger,
): boolean {
  if (trigger === "user") return false;
  return gaveUpVersion === version;
}
