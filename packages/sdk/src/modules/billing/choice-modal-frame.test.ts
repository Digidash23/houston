import { describe, expect, it } from "vitest";
import { BEFORE, choice, LA_FILA } from "./choice-fixtures";
import { type ChoiceModalContext, choiceModal } from "./choice-modal";
import {
  type ChoiceModalFrame,
  CLOSED_CHOICE_FRAME,
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

/** The frame after each modal in turn, from a closed one. */
const run = (...modals: (typeof pick)[]): ChoiceModalFrame =>
  modals.reduce(nextChoiceModalFrame, CLOSED_CHOICE_FRAME);

describe("nextChoiceModalFrame", () => {
  it("opens on the intro", () => {
    expect(run(pick)).toEqual({ open: true, shown: pick, picking: false });
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
      picking: false,
    });
  });

  it("keeps the last content through the close, then reopens on the intro", () => {
    const picking = startPicking(run(pick));
    const shut = nextChoiceModalFrame(picking, closed);
    expect(shut).toEqual({ open: false, shown: pick, picking: true });
    expect(nextChoiceModalFrame(shut, pick)).toEqual({
      open: true,
      shown: pick,
      picking: false,
    });
  });
});

describe("startPicking", () => {
  it("moves an open pick to the picker", () => {
    expect(startPicking(run(pick))).toMatchObject({ picking: true });
  });

  it("never opens the picker for a read-only notice or a closed frame", () => {
    const frame = run(single);
    expect(startPicking(frame)).toBe(frame);
    const shut = run(pick, closed);
    expect(startPicking(shut)).toBe(shut);
  });
});
