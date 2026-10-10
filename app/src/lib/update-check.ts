import { check } from "@tauri-apps/plugin-updater";
import { analytics } from "./analytics";
import type { UpdateCheckOutcome, UpdateOrigin } from "./update-policy";
import type { UpdateInfo, UpdateStatus } from "./update-status";

export type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

export type CheckResult = { outcome: UpdateCheckOutcome; message?: string };

export type FoundUpdate = { update: AvailableUpdate; info: UpdateInfo };

/**
 * One check of the release feed: the plugin's `check()`, the `update_offered`
 * analytics event on the FIRST sighting of a version, and the fail-open
 * classification `useUpdateChecker` counts. `previous` is the machine's
 * status before the check, so a re-sighting of the same release stays quiet.
 */
export async function runUpdateCheck(
  origin: UpdateOrigin,
  previous: UpdateStatus,
): Promise<{ result: CheckResult; found: FoundUpdate | null }> {
  try {
    const update = await check();
    if (!update) return { result: { outcome: "none" }, found: null };
    const info: UpdateInfo = {
      currentVersion: update.currentVersion,
      version: update.version,
      origin,
    };
    if (previous.state === "idle" || previous.info.version !== info.version) {
      analytics.track("update_offered", {
        from_version: info.currentVersion,
        to_version: info.version,
      });
    }
    return { result: { outcome: "found" }, found: { update, info } };
  } catch (error) {
    // Fail-open by design: a launch must never block on the release feed.
    // The checker counts these to surface a client that NEVER succeeds.
    console.warn("[updater] check failed", error);
    return {
      result: {
        outcome: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
      found: null,
    };
  }
}
