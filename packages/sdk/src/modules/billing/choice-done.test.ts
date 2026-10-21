import { describe, expect, it } from "vitest";
import type { BillingChoiceSave } from "./choice";
import {
  CLOSED_CHOICE_PICKER,
  choiceDone,
  choicePickerSaved,
  closeChoicePicker,
  openChoicePicker,
} from "./choice-done";
import { choice, INNOVA, LA_FILA, PERSONAL } from "./choice-fixtures";

const saved = (patch: Parameters<typeof choice>[0]): BillingChoiceSave => ({
  kind: "saved",
  choice: choice(patch),
});

describe("choiceDone", () => {
  it("tells a non-payer that the other orgs need a plan from the cutover", () => {
    expect(choiceDone(choice({ freeOrgSlug: LA_FILA.slug }), "en")).toEqual({
      kind: "others_need_plan",
      free: LA_FILA,
      date: "Friday, October 23",
    });
  });

  it("tells a payer which org the subscription pays for", () => {
    const stored = choice({
      payer: "plus",
      freeOrgSlug: LA_FILA.slug,
      paidOrgSlug: INNOVA.slug,
    });
    expect(choiceDone(stored, "en")).toEqual({
      kind: "payer",
      free: LA_FILA,
      paid: INNOVA,
      date: "Friday, October 23",
    });
  });

  it("formats the date in the reader's language", () => {
    const stored = choice({ freeOrgSlug: LA_FILA.slug });
    expect(choiceDone(stored, "es")?.date).toBe("viernes, 23 de octubre");
  });

  it("says nothing more when the free org is the only one left", () => {
    const stored = choice({ freeOrgSlug: PERSONAL.slug, orgs: [PERSONAL] });
    expect(choiceDone(stored, "en")).toMatchObject({ kind: "only_org" });
  });

  it("has no success step without a stored free pick", () => {
    expect(choiceDone(choice(), "en")).toBeNull();
    expect(choiceDone(choice({ freeOrgSlug: "gone" }), "en")).toBeNull();
  });
});

describe("the picker opened from Settings", () => {
  it("moves to the success step after a stored pick, until closed", () => {
    const frame = choicePickerSaved(
      openChoicePicker(),
      saved({ freeOrgSlug: INNOVA.slug }),
      "en",
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
    expect(choicePickerSaved(open, { kind: "not_owner" }, "en")).toBe(open);
    const stored = saved({ freeOrgSlug: INNOVA.slug });
    expect(choicePickerSaved(CLOSED_CHOICE_PICKER, stored, "en")).toBe(
      CLOSED_CHOICE_PICKER,
    );
  });
});
