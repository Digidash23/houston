import type { BillingChoice, BillingChoiceOrg } from "@houston/wire-types";
import type { BillingChoiceSave } from "./choice";
import { formatCutoverDate } from "./choice-model";

/**
 * What the picker's success step says once a pick is stored. `payer`: the
 * subscription pays for `paid` from the cutover. `others_need_plan`: the
 * person's other orgs need a plan from then. `only_org`: they own just the
 * free one now, so there is nothing else to say.
 */
export type ChoiceDone = {
  free: BillingChoiceOrg;
  /** The cutover, formatted as the intro formats it ("Friday, October 23"). */
  date: string;
} & (
  | { kind: "payer"; paid: BillingChoiceOrg }
  | { kind: "others_need_plan" }
  | { kind: "only_org" }
);

/** The success step for a stored choice, or null if it holds no free pick. */
export function choiceDone(
  saved: BillingChoice,
  locale?: string,
): ChoiceDone | null {
  const free = saved.orgs.find((org) => org.slug === saved.freeOrgSlug);
  if (!free) return null;
  const date = formatCutoverDate(saved.cutoverAt, locale);
  const paid = saved.orgs.find(
    (org) => org.slug === saved.paidOrgSlug && org.slug !== free.slug,
  );
  if (paid) return { kind: "payer", free, paid, date };
  return saved.orgs.length > 1
    ? { kind: "others_need_plan", free, date }
    : { kind: "only_org", free, date };
}

/**
 * The free-org picker opened on its own (Settings > Billing): the picker,
 * then its success step once a save is stored, until the person closes it.
 * A closed frame keeps `done` so the success step stays through the close
 * animation.
 */
export interface ChoicePickerFrame {
  open: boolean;
  done: ChoiceDone | null;
}

export const CLOSED_CHOICE_PICKER: ChoicePickerFrame = {
  open: false,
  done: null,
};

/** Opens on the picker, never on a success step left from the last open. */
export function openChoicePicker(): ChoicePickerFrame {
  return { open: true, done: null };
}

/** Closed by the person: the X, Escape, a click outside or Done. */
export function closeChoicePicker(frame: ChoicePickerFrame): ChoicePickerFrame {
  return frame.open ? { ...frame, open: false } : frame;
}

/**
 * The frame after a save answers. Only a stored pick moves to the success
 * step; a refusal keeps the picker, which shows the refusal's own copy.
 */
export function choicePickerSaved(
  frame: ChoicePickerFrame,
  outcome: BillingChoiceSave,
  locale?: string,
): ChoicePickerFrame {
  if (!frame.open || frame.done || outcome.kind !== "saved") return frame;
  const done = choiceDone(outcome.choice, locale);
  return done ? { open: true, done } : frame;
}
