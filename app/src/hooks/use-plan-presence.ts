import { useEffect } from "react";
import { logAndReportError } from "../lib/error-report";
import { markPlanPresence, planPresenceDue } from "../lib/plan-session";
import { tauriOrg } from "../lib/tauri";

/**
 * Tell the gateway the person is here (at most once per presence window)
 * whenever the app becomes visible or focused, on a deployment with plans.
 */
export function usePlanPresence(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const report = () => {
      if (
        document.visibilityState !== "visible" ||
        !planPresenceDue(Date.now())
      )
        return;
      markPlanPresence(Date.now());
      void tauriOrg
        .reportPresence()
        .catch((error: unknown) => logAndReportError("report_presence", error));
    };
    report();
    document.addEventListener("visibilitychange", report);
    window.addEventListener("focus", report);
    return () => {
      document.removeEventListener("visibilitychange", report);
      window.removeEventListener("focus", report);
    };
  }, [enabled]);
}
