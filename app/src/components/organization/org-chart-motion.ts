import { duration, durationMs, easing } from "@houston/design-tokens";
import type { CSSProperties } from "react";

/**
 * The org chart's motion, all from the motion tokens: the `entrance` curve
 * (a strong ease-out), `press` for press feedback and `fast` for reveals.
 * Driven from TS because the tokens reach CSS as no utility; nothing here
 * animates layout, only transform, opacity, filter (the preview, a button's
 * new label) and the share dialog's primary button's paint.
 */

export const ENTRANCE_CURVE = `cubic-bezier(${easing.entrance.join(", ")})`;
const STANDARD_CURVE = `cubic-bezier(${easing.standard.join(", ")})`;

/**
 * Press feedback for anything tappable: a 0.97 scale while held, eased back
 * on release. Tailwind 4 compiles `active:scale-*` to the CSS `scale`
 * property, so the transition list is the class's own `transition-transform`
 * (transform, translate, scale, rotate), which also replaces core Button's
 * `transition-all` through tailwind-merge. The style only sets the timing:
 * naming a property there would override the class and the press would snap.
 */
export const PRESS_CLASS = "transition-transform active:scale-[0.97]";

export const PRESS_STYLE: CSSProperties = {
  transitionDuration: duration.press,
  transitionTimingFunction: ENTRANCE_CURVE,
};

const PRESS_PROPERTIES = ["transform", "translate", "scale", "rotate"];
const PAINT_PROPERTIES = [
  "color",
  "background-color",
  "border-color",
  "opacity",
];

/**
 * PRESS_STYLE for a button whose variant follows a step (Connect's outline
 * turning into Post's fill): its paint also eases, over `fast`. Naming
 * properties here overrides PRESS_CLASS's list, so the press's are named too.
 */
export const STEP_PRESS_STYLE: CSSProperties = {
  transitionProperty: [...PRESS_PROPERTIES, ...PAINT_PROPERTIES].join(", "),
  transitionDuration: [
    ...PRESS_PROPERTIES.map(() => duration.press),
    ...PAINT_PROPERTIES.map(() => duration.fast),
  ].join(", "),
  transitionTimingFunction: [
    ...PRESS_PROPERTIES.map(() => ENTRANCE_CURVE),
    ...PAINT_PROPERTIES.map(() => STANDARD_CURVE),
  ].join(", "),
};

/**
 * A button's new label coming into focus. The old one is already gone, so a
 * blur bridges the swap instead of two labels overlapping; reduced motion
 * keeps only the fade.
 */
export function swapInKeyframes(reduced: boolean): Keyframe[] {
  return reduced
    ? [{ opacity: 0.5 }, { opacity: 1 }]
    : [
        { opacity: 0.5, filter: "blur(2px)" },
        { opacity: 1, filter: "blur(0)" },
      ];
}

/** The first reveal: one node every 40ms, each over the `fast` duration. */
export const REVEAL = {
  stepMs: 40,
  /** Past this many nodes the rest arrive together, so it never drags. */
  maxSteps: 12,
  durationMs: durationMs.fast,
  /** How far a node rises as it fades in; reduced motion drops it. */
  risePx: 5,
} as const;

export function revealDelay(index: number): number {
  return Math.min(index, REVEAL.maxSteps) * REVEAL.stepMs;
}

export function revealKeyframes(reduced: boolean): Keyframe[] {
  return reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: `translateY(${REVEAL.risePx}px)` },
        { opacity: 1, transform: "translateY(0)" },
      ];
}
