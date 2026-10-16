import { useCallback, useEffect, useRef, useState } from "react";
import { analytics } from "../lib/analytics";
import { reportError } from "../lib/error-report";
import { osCurrentAppBundlePath, osInstallUpdate } from "../lib/os-bridge";
import {
  type AvailableUpdate,
  type CheckResult,
  runUpdateCheck,
} from "../lib/update-check";
import { downloadReleaseBytes } from "../lib/update-download";
import { updateDownloadOutcome } from "../lib/update-download-failure";
import { reportUpdateDownloadFailure } from "../lib/update-download-report";
import { claimLaunchCheck } from "../lib/update-launch-claim";
import {
  type DownloadTrigger,
  shouldReportDownloadFailure,
  shouldSkipDownload,
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
 * installing → relaunch (or error). Scheduling and policy (when checks run,
 * what a find does) live in `useUpdateChecker`; this hook only moves states.
 *
 * Download and install are two steps on purpose: the release downloads while
 * the user keeps working, and the install (msiexec hand-off + exit on
 * Windows, bundle swap on macOS) runs only when something asks for it. Both
 * are the shell's own commands over the plugin's `Update` resource: its
 * single-shot download died mid-stream on a 300 MB asset (PRODUCT-1727).
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

  // The launch check is the first of the PROCESS (`update-launch-claim.ts`),
  // never of a mount; every later check is a poll.
  const runCheck = useCallback(async (): Promise<CheckResult> => {
    const origin = claimLaunchCheck();
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
   *  the next check finds the release again and the shell resumes from the
   *  bytes it kept, so a link that drops every few minutes still gets there.
   *  A release the disk refused is not asked for again by a poll this
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
      try {
        setStatus({ state: "downloading", info, progress: null });
        bytesRidRef.current = await downloadReleaseBytes(
          update.rid,
          info.origin,
          (progress) => setStatus({ state: "downloading", info, progress }),
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

  /** Install the staged release and relaunch into it; downloads first when
   *  nothing is buffered yet (the launch-time path and the person's own
   *  retry). On Windows the install hands off to the installer and exits
   *  this process. */
  const installAndRelaunch = useCallback(
    async (source: InstallSource) => {
      if (busyRef.current) return;
      if (statusRef.current.state !== "downloaded") {
        // A return installs only what a poll already staged, so nothing
        // async runs between its gates and the install; the others fetch.
        if (source === "return" || !(await download(source))) return;
      }
      const update = updateRef.current;
      const found = infoRef.current;
      const bytesRid = bytesRidRef.current;
      if (!update || !found || bytesRid === null) return;
      // A return's install runs behind the launch overlay, so its statuses
      // carry the return. The find itself stays the poll's (`infoRef`): a
      // retry after a failure downloads and reports as the poll it was.
      const info: UpdateInfo =
        source === "return" ? { ...found, origin: "return" } : found;

      busyRef.current = true;
      analytics.track("update_accepted", {
        from_version: info.currentVersion,
        to_version: info.version,
        source,
      });
      setStatus({ state: "installing", info });
      try {
        // Captured BEFORE the install: on macOS the install moves the bundle.
        appPathRef.current = await osCurrentAppBundlePath();
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

  /** The status as of now, for decisions made inside event listeners. */
  const currentStatus = useCallback(() => statusRef.current, []);

  return {
    status,
    currentStatus,
    runCheck,
    download,
    installAndRelaunch,
    relaunchInstalledApp,
  };
}
