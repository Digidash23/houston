import { reportError } from "./error-report";
import { osCurrentAppBundlePath, osRelaunchAppFromPath } from "./os-bridge";

/**
 * Relaunch into the installed release. `appPath` is the bundle path captured
 * BEFORE the install (on macOS the install moves the bundle, so resolving it
 * afterwards can land on the moved backup); the current one is the fallback
 * when nothing was captured. False when the OS refused: the failure is
 * reported here, and the caller shows the relaunch error state.
 */
export async function relaunchInstalledRelease(
  version: string,
  appPath: string | null,
): Promise<boolean> {
  try {
    await osRelaunchAppFromPath(appPath ?? (await osCurrentAppBundlePath()));
    return true;
  } catch (error) {
    console.error("[updater] relaunch failed", error);
    reportError("update_relaunch", `relaunch into ${version}`, error);
    return false;
  }
}
