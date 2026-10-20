import type {
  AnnouncedChoice,
  ChoiceModal,
  ShownChoiceModal,
} from "./choice-modal";

/**
 * What the pricing-change modal's frame shows, carried from one render to the
 * next. `shown` is the last open modal: it keeps the frame's content through
 * the close animation, after the notice itself has gone. `picking` puts the
 * picker in place of the intro, and only ever while the notice is `pick`.
 */
export interface ChoiceModalFrame {
  open: boolean;
  shown: ShownChoiceModal | null;
  picking: boolean;
}

export const CLOSED_CHOICE_FRAME: ChoiceModalFrame = {
  open: false,
  shown: null,
  picking: false,
};

/**
 * The frame for the latest {@link ChoiceModal}. It reopens on the intro, so a
 * modal hidden behind a plan dialog comes back where it started; a notice that
 * stops being a pick (a refusal's refetch shows the person cannot pick) drops
 * the picker. Answers `frame` itself when nothing changed, so a surface that
 * stores the frame can tell when to store it again.
 */
export function nextChoiceModalFrame(
  frame: ChoiceModalFrame,
  modal: ChoiceModal,
): ChoiceModalFrame {
  if (!modal.open) return frame.open ? { ...frame, open: false } : frame;
  const picking = frame.open && frame.picking && modal.notice.kind === "pick";
  const unchanged =
    frame.open &&
    frame.picking === picking &&
    frame.shown !== null &&
    frame.shown.close === modal.close &&
    sameNotice(frame.shown.notice, modal.notice);
  return unchanged ? frame : { open: true, shown: modal, picking };
}

/** The frame once the person asks to pick; unchanged unless a pick is open. */
export function startPicking(frame: ChoiceModalFrame): ChoiceModalFrame {
  if (!frame.open || frame.picking || frame.shown?.notice.kind !== "pick")
    return frame;
  return { ...frame, picking: true };
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
