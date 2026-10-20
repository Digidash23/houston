import { describe, expect, it } from "vitest";
import {
  BEFORE,
  CUTOVER,
  choice,
  INNOVA,
  LA_FILA,
  org,
  PERSONAL,
} from "./choice-fixtures";
import {
  canChangeChoice,
  choiceNotice,
  defaultFreeOrg,
  defaultPaidOrg,
  formatCutoverDate,
  payerTotals,
  pickerRows,
} from "./choice-model";

const at = (now: number, activeOrgSlug: string | null = null) => ({
  now,
  activeOrgSlug,
  locale: "en",
});

describe("choiceNotice", () => {
  it("asks an owner of several orgs to pick, naming the cutover day", () => {
    expect(choiceNotice(choice(), at(BEFORE))).toEqual({
      kind: "pick",
      date: "Friday, October 23",
      payer: false,
    });
  });

  it("tells a Plus or comp payer their subscription moves too", () => {
    for (const payer of ["plus", "comp"] as const)
      expect(choiceNotice(choice({ payer }), at(BEFORE))).toEqual({
        kind: "pick",
        date: "Friday, October 23",
        payer: true,
      });
    expect(choiceNotice(choice({ payer: "sponsored" }), at(BEFORE))).toEqual({
      kind: "pick",
      date: "Friday, October 23",
      payer: false,
    });
  });

  it("reads the stored pick back once it is saved", () => {
    expect(
      choiceNotice(choice({ freeOrgSlug: INNOVA.slug }), at(BEFORE)),
    ).toEqual({
      kind: "picked",
      day: "October 23",
      freeOrgSlug: INNOVA.slug,
      paidOrgSlug: null,
      othersNeedPlan: true,
    });
    const both = choice({
      payer: "plus",
      orgs: [LA_FILA, INNOVA],
      freeOrgSlug: LA_FILA.slug,
      paidOrgSlug: INNOVA.slug,
    });
    expect(choiceNotice(both, at(BEFORE))).toMatchObject({
      kind: "picked",
      paidOrgSlug: INNOVA.slug,
      othersNeedPlan: false,
    });
  });

  it("tells the owner of one org it stays free, from their own space", () => {
    const single = choice({ needed: false, orgs: [PERSONAL] });
    expect(choiceNotice(single, at(BEFORE))).toEqual({
      kind: "single_org",
      date: "Friday, October 23",
      orgSlug: PERSONAL.slug,
      payer: false,
    });
    expect(
      choiceNotice({ ...single, payer: "plus" }, at(BEFORE, PERSONAL.slug)),
    ).toMatchObject({ kind: "single_org", payer: true });
  });

  it("tells a member the owner decides, in an org they do not own", () => {
    const single = choice({ needed: false, orgs: [PERSONAL] });
    expect(choiceNotice(single, at(BEFORE, "ffffffffffffffff"))).toEqual({
      kind: "member",
      date: "Friday, October 23",
    });
    expect(
      choiceNotice(choice({ needed: false, orgs: [] }), at(BEFORE)),
    ).toEqual({ kind: "member", date: "Friday, October 23" });
  });

  it("hides once dismissed, applied, past the cutover, or unserved", () => {
    expect(choiceNotice(choice({ noticeDismissed: true }), at(BEFORE))).toEqual(
      { kind: "hidden" },
    );
    expect(choiceNotice(choice({ state: "applied" }), at(BEFORE))).toEqual({
      kind: "hidden",
    });
    expect(choiceNotice(choice(), at(Date.parse(CUTOVER)))).toEqual({
      kind: "hidden",
    });
    expect(choiceNotice(null, at(BEFORE))).toEqual({ kind: "hidden" });
  });

  it("names the day in the reader's language, as its UTC calendar day", () => {
    expect(formatCutoverDate(CUTOVER, "es")).toBe("viernes, 23 de octubre");
    expect(formatCutoverDate(CUTOVER, "pt")).toBe("sexta-feira, 23 de outubro");
    // A midnight anywhere in the Americas is still the 23rd in UTC.
    for (const seed of ["2026-10-23T00:00:00Z", "2026-10-23T07:00:00Z"])
      expect(formatCutoverDate(seed, "en")).toBe("Friday, October 23");
  });
});

describe("pickerRows", () => {
  it("lists the busiest first and tags it most active", () => {
    const rows = pickerRows(choice());
    expect(rows.map((row) => [row.org.name, row.mostActive])).toEqual([
      ["La Fila", true],
      ["Innova", false],
      ["daniel", false],
    ]);
  });

  it("breaks a message tie on recent activity, then the personal org, then slug", () => {
    const a = org({
      slug: "a000000000000000",
      messages30d: 5,
      lastActiveOn: "2026-10-01",
    });
    const b = org({
      slug: "b000000000000000",
      messages30d: 5,
      lastActiveOn: "2026-10-09",
    });
    const mine = org({ slug: "c000000000000000", personal: true });
    const z = org({ slug: "d000000000000000" });
    const y = org({ slug: "0000000000000000" });
    const rows = pickerRows(choice({ orgs: [z, a, mine, y, b] }));
    expect(rows.map((row) => row.org.slug)).toEqual([
      b.slug,
      a.slug,
      mine.slug,
      y.slug,
      z.slug,
    ]);
  });

  it("tags nothing when no org has messages", () => {
    const rows = pickerRows(choice({ orgs: [org(), org({ slug: "b" })] }));
    expect(rows.every((row) => !row.mostActive)).toBe(true);
  });

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

describe("payerTotals", () => {
  it("prices today, the grace end, and the full monthly total", () => {
    const priced = choice({
      payer: "plus",
      orgs: [
        { ...INNOVA, monthlyTotalCents: 6000, seatGraceEndsOn: "2026-11-22" },
        { ...PERSONAL, monthlyTotalCents: 1500 },
      ],
    });
    expect(payerTotals(priced, INNOVA.slug, "en")).toEqual({
      today: "$15",
      graceEndsOn: "November 22",
      monthly: "$60",
      seat: "$15",
    });
    expect(payerTotals(priced, PERSONAL.slug, "en")).toEqual({
      today: "$15",
      graceEndsOn: null,
      monthly: "$15",
      seat: "$15",
    });
    expect(payerTotals(priced, "missing", "en")).toBeNull();
  });
});

describe("canChangeChoice", () => {
  it("holds while a pending pick is still open", () => {
    expect(canChangeChoice(choice(), BEFORE)).toBe(true);
    expect(canChangeChoice(choice({ noticeDismissed: true }), BEFORE)).toBe(
      true,
    );
    expect(canChangeChoice(choice({ state: "applied" }), BEFORE)).toBe(false);
    expect(canChangeChoice(choice({ needed: false }), BEFORE)).toBe(false);
    expect(canChangeChoice(choice(), Date.parse(CUTOVER))).toBe(false);
    expect(
      canChangeChoice(
        choice({ changeableUntil: "2026-10-21T00:00:00.000Z" }),
        Date.parse("2026-10-22T00:00:00.000Z"),
      ),
    ).toBe(false);
    expect(canChangeChoice(null, BEFORE)).toBe(false);
  });
});
