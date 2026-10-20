import type { BillingChoice } from "@houston/wire-types";
import { choosesPaidOrg, pickerRows } from "./choice-model";

/** The org the picker starts on: the stored pick, else the busiest. */
export function defaultFreeOrg(choice: BillingChoice): string | null {
  const stored = choice.orgs.find((org) => org.slug === choice.freeOrgSlug);
  return stored?.slug ?? pickerRows(choice)[0]?.org.slug ?? null;
}

/** The org the payer step starts on: the stored paid org, else the busiest other. */
export function defaultPaidOrg(
  choice: BillingChoice,
  freeOrgSlug: string,
): string | null {
  const rows = pickerRows(choice).filter((row) => row.org.slug !== freeOrgSlug);
  const stored = rows.find((row) => row.org.slug === choice.paidOrgSlug);
  return (stored ?? rows[0])?.org.slug ?? null;
}

export interface PickerState {
  step: "free" | "paid";
  free: string | null;
  paid: string | null;
}

/**
 * The picker's state made valid against the latest choice. A refetch after a
 * refusal can drop an org the person no longer owns or end their payer
 * status; the picker then falls back to the busiest owned org and to the free
 * step instead of resubmitting what the gateway just refused.
 */
export function reconcilePick(
  choice: BillingChoice,
  state: PickerState,
): PickerState {
  const owned = (slug: string | null) =>
    slug !== null && choice.orgs.some((org) => org.slug === slug);
  const freeKept = owned(state.free);
  const free = freeKept ? state.free : defaultFreeOrg(choice);
  const paidOk =
    choosesPaidOrg(choice) && owned(state.paid) && state.paid !== free;
  // A replaced free org goes back to the free step to be confirmed.
  return {
    step: state.step === "paid" && paidOk && freeKept ? "paid" : "free",
    free,
    paid: paidOk ? state.paid : null,
  };
}

/**
 * Milliseconds until the notice next changes on its own (the end of the
 * change window, then the cutover), or null once both have passed. A surface
 * re-renders then so an open session never outlives the window.
 */
export function nextChoiceDeadline(
  choice: BillingChoice | null | undefined,
  now: number,
): number | null {
  if (!choice) return null;
  const upcoming = [choice.changeableUntil, choice.cutoverAt]
    .filter((value): value is string => value !== null)
    .map((value) => Date.parse(value) - now)
    .filter((ms) => ms > 0);
  return upcoming.length ? Math.min(...upcoming) : null;
}
