import { planMinIntervalRefusal } from "@houston/sdk";
import i18n from "./i18n";

/**
 * Expected business state, not a bug: a routine save the engine refused
 * because its schedule fires more often than the saver's plan allows (`400
 * plan_min_interval`, the server half of the editor's own floor). Shows the
 * plan's authored copy as a plain info toast, never the red bug pair and never
 * Sentry. True when the error was this refusal and has been surfaced.
 */
export async function surfacePlanMinInterval(err: unknown): Promise<boolean> {
  if (!planMinIntervalRefusal(err)) return false;
  const { showExpectedStateToast } = await import("./error-toast");
  showExpectedStateToast(
    i18n.t("plan:shortInterval"),
    i18n.t("plan:shortIntervalBody"),
  );
  return true;
}
