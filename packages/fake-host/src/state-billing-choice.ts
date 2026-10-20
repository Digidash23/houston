/**
 * The free-org pick a spec arms (`/__test__/billing-choice`): the
 * `BillingChoice` the gateway would compute for the signed-in person.
 *
 * Disarmed (the seed) is a gateway that predates the change: every route
 * answers 404, so every spec that never arms it runs exactly as before. The
 * routes mutate the armed choice the way the gateway's store would, and every
 * call lands in a ledger a spec reads back.
 */

import type { BillingChoice, BillingChoicePick } from "@houston/wire-types";

export type BillingChoiceCallRoute = "get" | "set" | "dismiss";

export interface BillingChoiceCall {
  route: BillingChoiceCallRoute;
  body?: unknown;
}

export type BillingPickRefusal = "not_owner" | "not_payer" | "same_org";

let armed: BillingChoice | null = null;
let forced: BillingPickRefusal | null = null;
let calls: BillingChoiceCall[] = [];

export function resetBillingChoice(): void {
  armed = null;
  forced = null;
  calls = [];
}

/**
 * Arm (or, with `null`, disarm) the choice; clears the ledger. `refuse`
 * makes every pick answer that refusal, which the client never provokes on
 * its own (it only offers orgs the person owns).
 */
export function armBillingChoice(
  choice: BillingChoice | null,
  refuse: BillingPickRefusal | null = null,
): void {
  armed = choice ? structuredClone(choice) : null;
  forced = refuse;
  calls = [];
}

export function billingChoice(): BillingChoice | null {
  return armed;
}

export function recordBillingChoiceCall(
  route: BillingChoiceCallRoute,
  body?: unknown,
): void {
  calls.push(body === undefined ? { route } : { route, body });
}

export function billingChoiceCalls(): BillingChoiceCall[] {
  return calls;
}

/** The gateway's refusal for a pick, in the gateway's order, or null when it stores. */
export function refuseBillingPick(
  choice: BillingChoice,
  pick: BillingChoicePick,
): BillingPickRefusal | null {
  if (forced) return forced;
  const paid = pick.paidOrgSlug;
  if (paid !== undefined && paid === pick.freeOrgSlug) return "same_org";
  if (paid !== undefined && choice.payer !== "plus" && choice.payer !== "comp")
    return "not_payer";
  const owned = (slug: string) => choice.orgs.some((org) => org.slug === slug);
  if (!owned(pick.freeOrgSlug)) return "not_owner";
  return paid === undefined || owned(paid) ? null : "not_owner";
}

export function storeBillingPick(
  choice: BillingChoice,
  pick: BillingChoicePick,
): BillingChoice {
  choice.freeOrgSlug = pick.freeOrgSlug;
  choice.paidOrgSlug = pick.paidOrgSlug ?? null;
  return choice;
}

export function dismissBillingChoice(choice: BillingChoice): void {
  choice.noticeDismissed = true;
}
