import { describe, expect, it } from "vitest";
import type { BillingChoiceSave } from "./choice";
import {
  CLOSED_CHOICE_PICKER,
  choiceDone,
  choicePickerSaved,
  closeChoicePicker,
  openChoicePicker,
} from "./choice-done";
import { CUTOVER, choice, INNOVA, LA_FILA, PERSONAL } from "./choice-fixtures";

const saved = (patch: Parameters<typeof choice>[0]): BillingChoiceSave => ({
  kind: "saved",
  choice: choice(patch),
});

describe("choiceDone", () => {
  it("tells a non-payer that the other orgs need a plan from the cutover", () => {
    expect(choiceDone(choice({ freeOrgSlug: LA_FILA.slug }))).toEqual({
      kind: "others_need_plan",
      free: LA_FILA,
      cutoverAt: CUTOVER,
    });
  });

  it("tells a payer which org the subscription pays for", () => {
    const stored = choice({
      payer: "plus",
      freeOrgSlug: LA_FILA.slug,
      paidOrgSlug: INNOVA.slug,
      orgs: [INNOVA, LA_FILA],
    });
    expect(choiceDone(stored)).toEqual({
      kind: "payer",
      free: LA_FILA,
      paid: INNOVA,
      othersNeedPlan: false,
      cutoverAt: CUTOVER,
    });
  });

  it("tells a payer with three orgs that the rest need a plan", () => {
    const stored = choice({
      payer: "comp",
      freeOrgSlug: LA_FILA.slug,
      paidOrgSlug: INNOVA.slug,
      orgs: [PERSONAL, INNOVA, LA_FILA],
    });
    expect(choiceDone(stored)).toMatchObject({
      kind: "payer",
      paid: INNOVA,
      othersNeedPlan: true,
    });
  });

  it("never names a paid org for someone with no subscription to move", () => {
    // A paid org left on the record from an earlier subscription.
    const stored = choice({
      payer: null,
      freeOrgSlug: LA_FILA.slug,
      paidOrgSlug: INNOVA.slug,
    });
    expect(choiceDone(stored)).toEqual({
      kind: "others_need_plan",
      free: LA_FILA,
      cutoverAt: CUTOVER,
    });
  });

  it("says nothing more when the free org is the only one left", () => {
    const stored = choice({ freeOrgSlug: PERSONAL.slug, orgs: [PERSONAL] });
    expect(choiceDone(stored)).toMatchObject({ kind: "only_org" });
  });

  it("has no success step without a stored free pick", () => {
    expect(choiceDone(choice())).toBeNull();
    expect(choiceDone(choice({ freeOrgSlug: "gone" }))).toBeNull();
  });
});

describe("the picker opened from Settings", () => {
  it("moves to the success step after a stored pick, until closed", () => {
    const frame = choicePickerSaved(
      openChoicePicker(),
      saved({ freeOrgSlug: INNOVA.slug }),
    );
    expect(frame).toMatchObject({
      open: true,
      done: { kind: "others_need_plan", free: INNOVA },
    });
    // Closing keeps the step for the close animation; reopening drops it.
    expect(closeChoicePicker(frame)).toEqual({ ...frame, open: false });
    expect(openChoicePicker()).toEqual({ open: true, done: null });
  });

  it("never shows the success step for a refusal or a closed picker", () => {
    const open = openChoicePicker();
    expect(choicePickerSaved(open, { kind: "not_owner" })).toBe(open);
    const stored = saved({ freeOrgSlug: INNOVA.slug });
    expect(choicePickerSaved(CLOSED_CHOICE_PICKER, stored)).toBe(
      CLOSED_CHOICE_PICKER,
    );
  });
});
