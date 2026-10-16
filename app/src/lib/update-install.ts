import { analytics } from "./analytics";
import { reportError } from "./error-report";
import { osCurrentAppBundlePath, osInstallUpdate } from "./os-bridge";
import type { ReturnHold } from "./update-return";
import type { InstallSource, UpdateInfo } from "./update-status";

/**
 * The install step: hand the bytes a download staged to the shell. Download
 * and install are two steps on purpose: the release downloads while the
 * person keeps working, and the install (msiexec hand-off + exit on Windows,
 * bundle swap on macOS) runs only when something asks for it. Both are the
 * shell's own commands over the plugin's `Update` resource: its single-shot
 * download died mid-stream on a 300 MB asset (PRODUCT-1727).
 */

export type InstallOutcome =
  /** `appPath` is the bundle path from BEFORE the install: on macOS the
   *  install moves the bundle, and the relaunch needs where it was. */
  | { outcome: "installed"; appPath: string }
  /** `lastLook` held the install back; the bytes stay staged. */
  | { outcome: "held" }
  /** The shell refused. Reported here; the caller shows it. */
  | { outcome: "failed" };

/**
 * `lastLook` runs after the one await before the point of no return (the
 * bundle path): whatever slipped in during it, such as a keystroke queued
 * behind a return event, holds the install back and is tracked as
 * update_return_held. update_accepted fires only for an install that starts.
 * On Windows the install hands off to the installer and exits this process,
 * so the promise never settles there.
 */
export async function installStagedRelease(args: {
  rid: number;
  bytesRid: number;
  info: UpdateInfo;
  source: InstallSource;
  lastLook: ReturnHold;
}): Promise<InstallOutcome> {
  const { rid, bytesRid, info, source, lastLook } = args;
  try {
    const appPath = await osCurrentAppBundlePath();
    const reason = lastLook();
    if (reason !== null) {
      analytics.track("update_return_held", { reason });
      return { outcome: "held" };
    }
    analytics.track("update_accepted", {
      from_version: info.currentVersion,
      to_version: info.version,
      source,
    });
    await osInstallUpdate(rid, bytesRid);
    return { outcome: "installed", appPath };
  } catch (error) {
    console.error("[updater] install failed", error);
    reportError("update_install", `install of ${info.version}`, error);
    return { outcome: "failed" };
  }
}
