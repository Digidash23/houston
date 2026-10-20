import type { BillingChoice, BillingChoiceOrg } from "@houston/wire-types";
import { formatPlanAmount } from "../plan/format";

/** One seat on any paid organization, before C3 sends the price per org. */
export const ORG_SEAT_PRICE_CENTS = 1500;
const CURRENCY = "usd";

/**
 * Where the person stands on the change. `pick`: an owner of several orgs who
 * has not picked (`payer`: their subscription also moves to an org they pick);
 * it stays until they pick, whatever `noticeDismissed` says. `picked`: the
 * pick is stored. `single_org`: the one org they own stays free (or, for a
 * subscriber, is what the subscription pays for). `member`: the person is in
 * an org someone else owns, so its owner decides. `hidden`: applied, past the
 * cutover, or a read-only notice that was dismissed.
 */
export type ChoiceNotice =
  | { kind: "hidden" }
  | { kind: "pick"; date: string; payer: boolean }
  | { kind: "picked"; freeOrgSlug: string; paidOrgSlug: string | null }
  | { kind: "single_org"; date: string; orgSlug: string; payer: boolean }
  | { kind: "member"; date: string };

export interface ChoiceContext {
  now: number;
  /** The active team's slug; null in the personal space, which is owned. */
  activeOrgSlug: string | null;
  locale?: string;
}

/**
 * Every billing-choice date reads as its UTC calendar day. The cutover is
 * seeded at midnight in the Americas (`05:00Z`), which is still that day in
 * UTC but the day before in the launch zone, and the grace end arrives as a
 * bare `YYYY-MM-DD`, which parses as UTC midnight.
 */
const DAY_ZONE = "UTC";

/** A cutover instant as weekday, month and day ("Friday, October 23"). */
export function formatCutoverDate(value: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: DAY_ZONE,
  }).format(new Date(value));
}

/** A cutover instant or a calendar day as month and day ("October 23"). */
export function formatCutoverDay(value: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    timeZone: DAY_ZONE,
  }).format(new Date(value));
}

/** True while the person may still pick, or change, their free org. */
export function canChangeChoice(
  choice: BillingChoice | null | undefined,
  now: number,
): choice is BillingChoice {
  if (choice?.state !== "pending" || !choice.needed) return false;
  return now < Date.parse(choice.changeableUntil ?? choice.cutoverAt);
}

/** A subscriber whose subscription moves to one org they choose. */
export function choosesPaidOrg(choice: BillingChoice): boolean {
  return (
    (choice.payer === "plus" || choice.payer === "comp") &&
    choice.orgs.length > 1
  );
}

export function choiceNotice(
  choice: BillingChoice | null | undefined,
  context: ChoiceContext,
): ChoiceNotice {
  if (
    !choice ||
    choice.state === "applied" ||
    context.now >= Date.parse(choice.cutoverAt)
  )
    return { kind: "hidden" };
  const date = formatCutoverDate(choice.cutoverAt, context.locale);
  const owned = (slug: string | null) =>
    slug === null || choice.orgs.some((org) => org.slug === slug);
  if (choice.needed && choice.freeOrgSlug && owned(choice.freeOrgSlug))
    return {
      kind: "picked",
      freeOrgSlug: choice.freeOrgSlug,
      paidOrgSlug: choice.paidOrgSlug,
    };
  if (choice.needed)
    return { kind: "pick", date, payer: choosesPaidOrg(choice) };
  if (choice.noticeDismissed) return { kind: "hidden" };
  const [only] = choice.orgs;
  if (!only || !owned(context.activeOrgSlug)) return { kind: "member", date };
  return {
    kind: "single_org",
    date,
    orgSlug: only.slug,
    payer: choice.payer === "plus" || choice.payer === "comp",
  };
}

export interface PickerRow {
  org: BillingChoiceOrg;
  /** The busiest org with any messages: the one most people keep free. */
  mostActive: boolean;
}

const lastActive = (org: BillingChoiceOrg) =>
  org.lastActiveOn ? Date.parse(org.lastActiveOn) : Number.NEGATIVE_INFINITY;

/**
 * Every owned org, busiest first: 30-day messages, then the latest activity,
 * then the personal org, then the slug, so equal orgs always list the same way.
 */
export function pickerRows(choice: BillingChoice): PickerRow[] {
  const sorted = [...choice.orgs].sort(
    (a, b) =>
      b.messages30d - a.messages30d ||
      lastActive(b) - lastActive(a) ||
      Number(b.personal) - Number(a.personal) ||
      a.slug.localeCompare(b.slug),
  );
  return sorted.map((org, index) => ({
    org,
    mostActive: index === 0 && org.messages30d > 0,
  }));
}

export interface PayerTotals {
  /** What the subscription costs today. */
  today: string;
  /** When extra seats start to bill; null for a one-member org. */
  graceEndsOn: string | null;
  /** The monthly total once every member is billed. */
  monthly: string;
  /** One seat, for the "$15 each" line. */
  seat: string;
}

/** The price a payer sees for moving their subscription to `slug`. */
export function payerTotals(
  choice: BillingChoice,
  slug: string,
  locale?: string,
): PayerTotals | null {
  const org = choice.orgs.find((candidate) => candidate.slug === slug);
  if (!org) return null;
  const monthly =
    org.monthlyTotalCents ??
    ORG_SEAT_PRICE_CENTS * Math.max(1, org.memberCount);
  return {
    today: formatPlanAmount(ORG_SEAT_PRICE_CENTS, CURRENCY, locale),
    graceEndsOn: org.seatGraceEndsOn
      ? formatCutoverDay(org.seatGraceEndsOn, locale)
      : null,
    monthly: formatPlanAmount(monthly, CURRENCY, locale),
    seat: formatPlanAmount(ORG_SEAT_PRICE_CENTS, CURRENCY, locale),
  };
}

/** One seat on a paid org, for the announcement's price. */
export function orgSeatPrice(locale?: string): string {
  return formatPlanAmount(ORG_SEAT_PRICE_CENTS, CURRENCY, locale);
}
