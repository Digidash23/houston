import { describe, expect, it } from "vitest";
import type { BillingChoiceSave } from "./choice";
import { BEFORE, choice, INNOVA, LA_FILA } from "./choice-fixtures";
import { type ChoiceModalContext, choiceModal } from "./choice-modal";
import {
  type ChoiceModalFrame,
  CLOSED_CHOICE_FRAME,
  closeChoiceFrame,
  finishPicking,
  nextChoiceModalFrame,
  startPicking,
} from "./choice-modal-frame";

const at = (patch: Partial<ChoiceModalContext> = {}): ChoiceModalContext => ({
  now: BEFORE,
  locale: "en",
  closedThisSession: false,
  otherDialogOpen: false,
  ...patch,
});

const pick = choiceModal(choice(), at());
const single = choiceModal(choice({ needed: false, orgs: [LA_FILA] }), at());
const closed = choiceModal(choice(), at({ otherDialogOpen: true }));
const stored = choice({ freeOrgSlug: INNOVA.slug });
const saved: BillingChoiceSave = { kind: "saved", choice: stored };
/** The modal once the save's refetch shows the stored pick. */
const picked = choiceModal(stored, at());
const INTRO = { step: "intro" };

/** The frame after each modal in turn, from a closed one. */
const run = (...modals: (typeof pick)[]): ChoiceModalFrame =>
  modals.reduce(nextChoiceModalFrame, CLOSED_CHOICE_FRAME);
const savedFrame = () => finishPicking(startPicking(run(pick)), saved, "en");

describe("nextChoiceModalFrame", () => {
  it("opens on the intro", () => {
    expect(run(pick)).toEqual({ open: true, shown: pick, phase: INTRO });
  });

  it("answers the same frame while nothing changes, so a render settles", () => {
    const frame = startPicking(run(pick));
    expect(nextChoiceModalFrame(frame, choiceModal(choice(), at()))).toBe(
      frame,
    );
    const shut = nextChoiceModalFrame(frame, closed);
    expect(nextChoiceModalFrame(shut, closed)).toBe(shut);
  });

  it("drops the picker when the notice stops being a pick", () => {
    // A refusal's refetch shows the person owns one org now: nothing to pick.
    expect(nextChoiceModalFrame(startPicking(run(pick)), single)).toEqual({
      open: true,
      shown: single,
      phase: INTRO,
    });
  });

  it("keeps the last content through the close, then reopens on the intro", () => {
    const picking = startPicking(run(pick));
    const shut = nextChoiceModalFrame(picking, closed);
    expect(shut).toEqual({
      open: false,
      shown: pick,
      phase: { step: "picking" },
    });
    expect(nextChoiceModalFrame(shut, pick)).toEqual({
      open: true,
      shown: pick,
      phase: INTRO,
    });
  });
});

describe("startPicking", () => {
  it("moves an open pick to the picker", () => {
    expect(startPicking(run(pick)).phase).toEqual({ step: "picking" });
  });

  it("never opens the picker for a read-only notice or a closed frame", () => {
    const frame = run(single);
    expect(startPicking(frame)).toBe(frame);
    const shut = run(pick, closed);
    expect(startPicking(shut)).toBe(shut);
  });
});

describe("the success step", () => {
  it("follows a stored pick, naming the free org and the cutover", () => {
    expect(savedFrame()).toMatchObject({
      open: true,
      phase: {
        step: "done",
        done: {
          kind: "others_need_plan",
          free: INNOVA,
          date: "Friday, October 23",
        },
      },
    });
  });

  it("survives the refetch that turns the notice into picked", () => {
    expect(picked).toEqual({ open: false });
    const frame = savedFrame();
    expect(nextChoiceModalFrame(frame, picked)).toBe(frame);
    // A plan dialog arriving meanwhile does not take it away either.
    expect(nextChoiceModalFrame(frame, closed)).toBe(frame);
  });

  it("closes only when the person closes it, and stays closed", () => {
    const shut = closeChoiceFrame(savedFrame());
    expect(shut).toMatchObject({ open: false, phase: { step: "done" } });
    expect(nextChoiceModalFrame(shut, picked)).toBe(shut);
    const session = choiceModal(stored, at({ closedThisSession: true }));
    expect(nextChoiceModalFrame(shut, session)).toBe(shut);
  });

  it("never follows a refusal", () => {
    const picking = startPicking(run(pick));
    for (const kind of ["not_owner", "not_payer", "same_org"] as const)
      expect(finishPicking(picking, { kind }, "en")).toBe(picking);
  });

  it("needs an open picker: never from the intro or a closed frame", () => {
    const intro = run(pick);
    expect(finishPicking(intro, saved, "en")).toBe(intro);
    const shut = closeChoiceFrame(startPicking(run(pick)));
    expect(finishPicking(shut, saved, "en")).toBe(shut);
  });

  it("ignores a save that stored no free pick", () => {
    const picking = startPicking(run(pick));
    const empty: BillingChoiceSave = { kind: "saved", choice: choice() };
    expect(finishPicking(picking, empty, "en")).toBe(picking);
  });

  it("reopens on the intro if the notice ever asks again", () => {
    const shut = closeChoiceFrame(savedFrame());
    expect(nextChoiceModalFrame(shut, pick)).toEqual({
      open: true,
      shown: pick,
      phase: INTRO,
    });
  });
});
