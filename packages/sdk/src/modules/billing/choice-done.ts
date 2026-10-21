import type { BillingChoice, BillingChoiceOrg } from "@houston/wire-types";
import type { BillingChoiceSave } from "./choice";
import { canChangeChoice, choosesPaidOrg } from "./choice-model";

/**
 * What the picker's success step says once a pick is stored. `payer`: the
 * subscription pays for `paid` from the cutover (`othersNeedPlan`: they own
 * more orgs than the free and the paid one, and those need a plan from then).
 * `others_need_plan`: the person's other orgs need a plan from then.
 * `only_org`: they own just the free one now, so there is nothing else to say.
 */
export type ChoiceDone = {
  free: BillingChoiceOrg;
  /**
   * The cutover instant. The surface formats it when it renders
   * ({@link formatCutoverDate}), so a language change reaches an open step.
   */
  cutoverAt: string;
} & (
  | { kind: "payer"; paid: BillingChoiceOrg; othersNeedPlan: boolean }
  | { kind: "others_need_plan" }
  | { kind: "only_org" }
);

/** The success step for a stored choice, or null if it holds no free pick. */
export function choiceDone(saved: BillingChoice): ChoiceDone | null {
  const free = saved.orgs.find((org) => org.slug === saved.freeOrgSlug);
  if (!free) return null;
  const { cutoverAt } = saved;
  // A paid org on the record means nothing without a subscription to move.
  const paid = choosesPaidOrg(saved)
    ? saved.orgs.find(
        (org) => org.slug === saved.paidOrgSlug && org.slug !== free.slug,
      )
    : undefined;
  if (paid)
    return {
      kind: "payer",
      free,
      paid,
      othersNeedPlan: saved.orgs.length > 2,
      cutoverAt,
    };
  return saved.orgs.length > 1
    ? { kind: "others_need_plan", free, cutoverAt }
    : { kind: "only_org", free, cutoverAt };
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
): ChoicePickerFrame {
  if (!frame.open || frame.done || outcome.kind !== "saved") return frame;
  const done = choiceDone(outcome.choice);
  return done ? { open: true, done } : frame;
}

/**
 * What Settings > Billing shows for the pick. `row`: the entry that opens the
 * picker, while the pick may still change ({@link canChangeChoice}). `frame`:
 * the window closed while the picker or its success step was open, so only
 * that frame stays, until the person closes it; a save just before the
 * deadline keeps its confirmation. `none`: nothing.
 */
export type ChoicePickerEntry = "row" | "frame" | "none";

export function choicePickerEntry(
  choice: BillingChoice | null | undefined,
  now: number,
  frame: ChoicePickerFrame,
): ChoicePickerEntry {
  if (!choice) return "none";
  if (canChangeChoice(choice, now)) return "row";
  return frame.open ? "frame" : "none";
}
