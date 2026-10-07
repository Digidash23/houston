import { useUIStore } from "../stores/ui";
import i18n from "./i18n";
import { surfacePlanMinInterval } from "./plan-min-interval";
import type { QuietErrorClass } from "./quiet-error-class";
import { reportQuietError } from "./quiet-error-report";

/**
 * The quiet classes (PRODUCT-1735) `showErrorToast` hands off besides offline
 * and waking, which keep their deduped toasts in `error-toast.ts`. Each keeps
 * its own surface and its ONE fingerprinted warning, or no report at all for
 * a business state. False for a class this does not own: the failure then
 * takes the toast layer's normal report path. Split out of `error-toast.ts`
 * to keep that module small.
 */
export function surfaceQuietState(
  quiet: QuietErrorClass,
  command: string,
  message: string,
  originalError: unknown,
): boolean {
  switch (quiet) {
    // PRODUCT-1833: the bridge classes have an inline surface already.
    case "bridge_unsupported":
    case "bridge_no_agent":
    case "bridge_state":
      console.error(`[toast:${command}] ${message}`);
      reportQuietError(quiet, command, message, originalError);
      return true;
    case "plan_min_interval":
      // A business state: the plan's copy naming the refusal's floor, and
      // nothing to report.
      return surfacePlanMinInterval(originalError);
    case "no_url_handler":
      // Same remedy copy `openExternalUrl` shows; a rejection that reached
      // this surface skipped that seam (a raw `osOpenUrl` caller).
      console.error(`[toast:${command}] ${message}`);
      reportQuietError("no_url_handler", command, message, originalError);
      useUIStore.getState().addToast({
        title: i18n.t("shell:openUrl.noBrowserTitle"),
        description: i18n.t("shell:openUrl.noBrowser"),
        variant: "info",
      });
      return true;
    default:
      return false;
  }
}
