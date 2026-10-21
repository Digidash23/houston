import type { BillingChoiceSave } from "./choice";
import { type ChoiceDone, choiceDone } from "./choice-done";
import type {
  AnnouncedChoice,
  ChoiceModal,
  ShownChoiceModal,
} from "./choice-modal";

/**
 * Which step the modal's frame shows: the intro, the picker (only ever while
 * the notice is `pick`), or the success step after a stored pick.
 */
export type ChoiceModalPhase =
  | { step: "intro" }
  | { step: "picking" }
  | { step: "done"; done: ChoiceDone };

/**
 * What the pricing-change modal's frame shows, carried from one render to the
 * next. `shown` is the last open modal: it keeps the frame's content through
 * the close animation, after the notice itself has gone.
 */
export interface ChoiceModalFrame {
  open: boolean;
  shown: ShownChoiceModal | null;
  phase: ChoiceModalPhase;
}

const INTRO: ChoiceModalPhase = { step: "intro" };

export const CLOSED_CHOICE_FRAME: ChoiceModalFrame = {
  open: false,
  shown: null,
  phase: INTRO,
};

/**
 * The frame for the latest {@link ChoiceModal}. It reopens on the intro, so a
 * modal hidden behind a plan dialog comes back where it started; a notice that
 * stops being a pick (a refusal's refetch shows the person cannot pick) drops
 * the picker. An open success step ignores the modal: the stored pick turns
 * the notice into `picked`, which hides the modal, and only the person closes
 * that step ({@link closeChoiceFrame}). Answers `frame` itself when nothing
 * changed, so a surface that stores the frame can tell when to store it again.
 */
export function nextChoiceModalFrame(
  frame: ChoiceModalFrame,
  modal: ChoiceModal,
): ChoiceModalFrame {
  if (frame.open && frame.phase.step === "done") return frame;
  if (!modal.open) return frame.open ? { ...frame, open: false } : frame;
  const picking =
    frame.open &&
    frame.phase.step === "picking" &&
    modal.notice.kind === "pick";
  const unchanged =
    frame.open &&
    picking === (frame.phase.step === "picking") &&
    frame.shown !== null &&
    frame.shown.close === modal.close &&
    sameNotice(frame.shown.notice, modal.notice);
  if (unchanged) return frame;
  return { open: true, shown: modal, phase: picking ? frame.phase : INTRO };
}

/** The frame once the person asks to pick; unchanged unless a pick is open. */
export function startPicking(frame: ChoiceModalFrame): ChoiceModalFrame {
  if (
    !frame.open ||
    frame.phase.step !== "intro" ||
    frame.shown?.notice.kind !== "pick"
  )
    return frame;
  return { ...frame, phase: { step: "picking" } };
}

/**
 * The frame after a save answers. A stored pick moves an open picker to the
 * success step; a refusal keeps the picker, which shows the refusal's own
 * copy, and never reaches the success step.
 */
export function finishPicking(
  frame: ChoiceModalFrame,
  outcome: BillingChoiceSave,
  locale?: string,
): ChoiceModalFrame {
  if (!frame.open || frame.phase.step !== "picking") return frame;
  if (outcome.kind !== "saved") return frame;
  const done = choiceDone(outcome.choice, locale);
  return done ? { ...frame, phase: { step: "done", done } } : frame;
}

/**
 * The frame once the person closes it: the X, Escape, a click outside, or a
 * button. It keeps its content through the close animation; whether it may
 * open again is the modal's call (a closed session, a stored pick).
 */
export function closeChoiceFrame(frame: ChoiceModalFrame): ChoiceModalFrame {
  return frame.open ? { ...frame, open: false } : frame;
}

function sameNotice(a: AnnouncedChoice, b: AnnouncedChoice): boolean {
  const left: Record<string, unknown> = a;
  const right: Record<string, unknown> = b;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}
