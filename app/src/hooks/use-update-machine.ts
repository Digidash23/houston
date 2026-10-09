import { useCallback, useEffect, useRef, useState } from "react";
import { analytics } from "../lib/analytics";
import { reportError } from "../lib/error-report";
import {
  osCurrentAppBundlePath,
  osDownloadUpdate,
  osInstallUpdate,
} from "../lib/os-bridge";
import {
  type AvailableUpdate,
  type CheckResult,
  runUpdateCheck,
} from "../lib/update-check";
import { updateDownloadOutcome } from "../lib/update-download-failure";
import {
  applyDownloadEvent,
  type DownloadTally,
  EMPTY_DOWNLOAD_TALLY,
} from "../lib/update-download-progress";
import { reportUpdateDownloadFailure } from "../lib/update-download-report";
import { claimLaunchCheck } from "../lib/update-launch-claim";
import {
  type DownloadTrigger,
  downloadAttemptBudget,
  shouldReportDownloadFailure,
  shouldSkipDownload,
  type UpdateOrigin,
} from "../lib/update-policy";
import { relaunchInstalledRelease } from "../lib/update-relaunch";
import {
  type InstallSource,
  type UpdateInfo,
  type UpdateStatus,
  updateCheckBlocked,
} from "../lib/update-status";

export type { InstallSource, UpdateInfo, UpdateStatus };

/**
 * The updater state machine: check → available → downloading → downloaded →
 * installing → relaunch (or error). Scheduling (when checks run) and policy
 * (what a find does) live in `useUpdateChecker`; this hook only moves
 * between states.
 *
 * Download and install are two steps on purpose: the release downloads in
 * the background while the user keeps working, and the install (msiexec
 * hand-off + process exit on Windows, bundle swap on macOS) runs only when
 * something explicitly asks for it. Both are the shell's own commands over
 * the plugin's `Update` resource: the plugin's single-shot download died
 * mid-stream on a 300 MB asset with no resume (PRODUCT-1727).
 */
export function useUpdateMachine() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const updateRef = useRef<AvailableUpdate | null>(null);
  const infoRef = useRef<UpdateInfo | null>(null);
  const statusRef = useRef<UpdateStatus>(status);
  const busyRef = useRef(false);
  const appPathRef = useRef<string | null>(null);
  // Staged release bytes (a shell resource id) once a download landed.
  const bytesRidRef = useRef<number | null>(null);
  const reportedRef = useRef<string | null>(null);
  // The release whose download the disk refused: no retry this session.
  const gaveUpRef = useRef<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const runCheck = useCallback(async (): Promise<CheckResult> => {
    // The first check of the PROCESS is the launch check: the user just
    // opened the app and hasn't started working. Everything after is
    // mid-session. Claimed outside React on purpose: this hook is remounted
    // with <App/> on every identity change, and a per-mount flag would
    // re-run the launch-time install on a user mid-task.
    const origin: UpdateOrigin = claimLaunchCheck();
    if (busyRef.current || updateCheckBlocked(statusRef.current)) {
      return { outcome: "skipped" };
    }
    const { result, found } = await runUpdateCheck(origin, statusRef.current);
    if (result.outcome === "none") {
      updateRef.current = null;
      infoRef.current = null;
      setStatus({ state: "idle" });
    } else if (found) {
      updateRef.current = found.update;
      infoRef.current = found.info;
      setStatus({ state: "available", info: found.info });
    }
    return result;
  }, []);

  /** Fetch the release into the shell's staging buffer; true once it can
   *  be installed. A failure is reported (once per version), never shown:
   *  the next check finds the release again and the download re-runs, and
   *  the shell carries on from the bytes it kept on disk rather than from
   *  zero, so a link that drops every few minutes still gets there. A
   *  release the disk refused is not asked for again by a poll this
   *  session; the person's own retry always is. */
  const download = useCallback(
    async (trigger: DownloadTrigger): Promise<boolean> => {
      const update = updateRef.current;
      const info = infoRef.current;
      if (!update || !info || busyRef.current) return false;
      if (statusRef.current.state === "downloaded") return true;
      if (shouldSkipDownload(gaveUpRef.current, info.version, trigger))
        return false;

      busyRef.current = true;
      let tally: DownloadTally = EMPTY_DOWNLOAD_TALLY;
      try {
        setStatus({ state: "downloading", info, progress: null });
        bytesRidRef.current = await osDownloadUpdate(
          update.rid,
          downloadAttemptBudget(info.origin),
          (event) => {
            const next = applyDownloadEvent(tally, event);
            tally = next.tally;
            setStatus({ state: "downloading", info, progress: next.progress });
          },
        );
        setStatus({ state: "downloaded", info });
        analytics.track("update_downloaded", {
          from_version: info.currentVersion,
          to_version: info.version,
          source: info.origin,
        });
        return true;
      } catch (error) {
        const outcome = updateDownloadOutcome(error);
        if (outcome === "give_up") gaveUpRef.current = info.version;
        if (outcome !== "skip") {
          console.error("[updater] download failed", error);
          if (shouldReportDownloadFailure(reportedRef.current, info.version)) {
            reportedRef.current = info.version;
            reportUpdateDownloadFailure(info.version, error);
          }
        }
        setStatus({ state: "error", info, phase: "download" });
        return false;
      } finally {
        busyRef.current = false;
      }
    },
    [],
  );

  const relaunchInstalledApp = useCallback(async () => {
    const info = infoRef.current;
    if (!info) return;
    if (!(await relaunchInstalledRelease(info.version, appPathRef.current)))
      setStatus({ state: "error", info, phase: "relaunch" });
  }, []);

  /** Install the downloaded release and relaunch into it; downloads first
   *  when nothing is buffered yet (the launch-time path). On Windows the
   *  install hands off to the installer and exits this process. */
  const installAndRelaunch = useCallback(
    async (source: InstallSource) => {
      if (busyRef.current) return;
      if (statusRef.current.state !== "downloaded" && !(await download(source)))
        return;
      const update = updateRef.current;
      const info = infoRef.current;
      const bytesRid = bytesRidRef.current;
      if (!update || !info || bytesRid === null) return;

      busyRef.current = true;
      analytics.track("update_accepted", {
        from_version: info.currentVersion,
        to_version: info.version,
        source,
      });
      try {
        // Captured BEFORE the install: on macOS the install moves the bundle.
        appPathRef.current = await osCurrentAppBundlePath();
        setStatus({ state: "installing", info });
        await osInstallUpdate(update.rid, bytesRid);
        bytesRidRef.current = null;
      } catch (error) {
        console.error("[updater] install failed", error);
        reportError("update_install", `install of ${info.version}`, error);
        setStatus({ state: "error", info, phase: "install" });
        return;
      } finally {
        busyRef.current = false;
      }
      await relaunchInstalledApp();
    },
    [download, relaunchInstalledApp],
  );

  return {
    status,
    runCheck,
    download,
    installAndRelaunch,
    relaunchInstalledApp,
  };
}
