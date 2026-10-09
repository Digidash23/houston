import type { Config } from "../data/config";

/** Only an explicit `"pending"` offers the start button: an absent field is an
 *  employee that predates it or joined with no first day to run. */
export function isFirstDayPending(config: Config | undefined): boolean {
  return config?.firstDay === "pending";
}
