import { describe, expect, it } from "vitest";
import {
  BEFORE,
  CUTOVER,
  choice,
  INNOVA,
  LA_FILA,
  PERSONAL,
} from "./choice-fixtures";
import {
  defaultFreeOrg,
  defaultPaidOrg,
  nextChoiceDeadline,
  reconcilePick,
} from "./choice-picker";

describe("the picker's starting point", () => {
  it("starts on the stored pick, else the busiest", () => {
    expect(defaultFreeOrg(choice())).toBe(LA_FILA.slug);
    expect(defaultFreeOrg(choice({ freeOrgSlug: PERSONAL.slug }))).toBe(
      PERSONAL.slug,
    );
    expect(defaultPaidOrg(choice(), LA_FILA.slug)).toBe(INNOVA.slug);
    expect(
      defaultPaidOrg(choice({ paidOrgSlug: PERSONAL.slug }), LA_FILA.slug),
    ).toBe(PERSONAL.slug);
    expect(
      defaultPaidOrg(choice({ paidOrgSlug: LA_FILA.slug }), LA_FILA.slug),
    ).toBe(INNOVA.slug);
  });
});

describe("reconcilePick", () => {
  const paidStep = {
    step: "paid" as const,
    free: LA_FILA.slug,
    paid: INNOVA.slug,
  };

  it("keeps a valid payer step as it is", () => {
    expect(reconcilePick(choice({ payer: "plus" }), paidStep)).toEqual(
      paidStep,
    );
  });

  it("drops back to the free step once the subscription is gone", () => {
    expect(reconcilePick(choice({ payer: null }), paidStep)).toEqual({
      step: "free",
      free: LA_FILA.slug,
      paid: null,
    });
  });

  it("replaces an org the person no longer owns with the busiest one", () => {
    const left = choice({ payer: "plus", orgs: [PERSONAL, INNOVA] });
    expect(reconcilePick(left, paidStep)).toEqual({
      step: "free",
      free: INNOVA.slug,
      paid: null,
    });
    const paidGone = choice({ payer: "plus", orgs: [PERSONAL, LA_FILA] });
    expect(reconcilePick(paidGone, paidStep)).toEqual({
      step: "free",
      free: LA_FILA.slug,
      paid: null,
    });
  });
});

describe("nextChoiceDeadline", () => {
  it("counts down to the change window, then the cutover", () => {
    const cutover = Date.parse(CUTOVER);
    expect(nextChoiceDeadline(choice(), BEFORE)).toBe(cutover - BEFORE);
    const window = choice({ changeableUntil: "2026-10-21T00:00:00Z" });
    expect(nextChoiceDeadline(window, BEFORE)).toBe(
      Date.parse("2026-10-21T00:00:00Z") - BEFORE,
    );
    expect(nextChoiceDeadline(choice(), cutover)).toBeNull();
    expect(nextChoiceDeadline(null, BEFORE)).toBeNull();
  });
});
