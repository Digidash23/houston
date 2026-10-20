import { describe, expect, it } from "vitest";
import {
  BEFORE,
  CUTOVER,
  choice,
  INNOVA,
  LA_FILA,
  PERSONAL,
} from "./choice-fixtures";
import { type ChoiceModalContext, choiceModal } from "./choice-modal";

const at = (patch: Partial<ChoiceModalContext> = {}): ChoiceModalContext => ({
  now: BEFORE,
  activeOrgSlug: null,
  locale: "en",
  laterThisSession: false,
  otherDialogOpen: false,
  ...patch,
});

const single = choice({ needed: false, orgs: [PERSONAL] });

describe("choiceModal", () => {
  it("asks an owner who has to pick on every app open, closing for the session", () => {
    expect(choiceModal(choice(), at())).toEqual({
      open: true,
      notice: { kind: "pick", date: "Friday, October 23", payer: false },
      close: "session",
    });
    expect(choiceModal(choice({ payer: "plus" }), at())).toMatchObject({
      open: true,
      notice: { kind: "pick", payer: true },
      close: "session",
    });
  });

  it("waits for the next app open after Maybe later", () => {
    expect(choiceModal(choice(), at({ laterThisSession: true }))).toEqual({
      open: false,
    });
  });

  it("still asks after a stored dismissal, since the pick is still open", () => {
    expect(choiceModal(choice({ noticeDismissed: true }), at())).toMatchObject({
      open: true,
      close: "session",
    });
  });

  it("shows a read-only notice once, closing it everywhere", () => {
    expect(choiceModal(single, at())).toEqual({
      open: true,
      notice: {
        kind: "single_org",
        date: "Friday, October 23",
        orgSlug: PERSONAL.slug,
        payer: false,
      },
      close: "everywhere",
    });
    expect(
      choiceModal(single, at({ activeOrgSlug: "ffffffffffffffff" })),
    ).toEqual({
      open: true,
      notice: { kind: "member", date: "Friday, October 23" },
      close: "everywhere",
    });
    expect(choiceModal({ ...single, noticeDismissed: true }, at())).toEqual({
      open: false,
    });
  });

  it("ignores Maybe later for a read-only notice, which has none", () => {
    expect(choiceModal(single, at({ laterThisSession: true }))).toMatchObject({
      open: true,
      close: "everywhere",
    });
  });

  it("shows nothing once the pick is stored", () => {
    const picked = choice({ freeOrgSlug: LA_FILA.slug });
    expect(choiceModal(picked, at())).toEqual({ open: false });
    expect(
      choiceModal(
        choice({
          payer: "plus",
          freeOrgSlug: LA_FILA.slug,
          paidOrgSlug: INNOVA.slug,
        }),
        at(),
      ),
    ).toEqual({ open: false });
  });

  it("never stacks on a plan dialog, and returns once it is gone", () => {
    expect(choiceModal(choice(), at({ otherDialogOpen: true }))).toEqual({
      open: false,
    });
    expect(choiceModal(single, at({ otherDialogOpen: true }))).toEqual({
      open: false,
    });
    expect(choiceModal(choice(), at({ otherDialogOpen: false }))).toMatchObject(
      { open: true },
    );
  });

  it("shows nothing when applied, past the cutover, or unserved", () => {
    expect(choiceModal(choice({ state: "applied" }), at())).toEqual({
      open: false,
    });
    expect(choiceModal(choice(), at({ now: Date.parse(CUTOVER) }))).toEqual({
      open: false,
    });
    expect(choiceModal(null, at())).toEqual({ open: false });
    expect(choiceModal(undefined, at())).toEqual({ open: false });
  });
});
