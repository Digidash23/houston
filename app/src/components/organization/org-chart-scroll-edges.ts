import { space } from "@houston/design-tokens";

/**
 * Which sides of a sideways scroller hide more content, and the fade that
 * says so. Pure and DOM-free. The fade is the visible cue that the chart
 * scrolls: overlay scrollbars (macOS, phones) only show while scrolling.
 */

export interface ScrollEdges {
  /** Content hides past the left edge. */
  start: boolean;
  /** Content hides past the right edge. */
  end: boolean;
}

export const NO_EDGES: ScrollEdges = { start: false, end: false };

/** Sub-pixel slack, so a scroller resting at its end reads as at the end. */
const SLACK = 1;

export function scrollEdges(box: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): ScrollEdges {
  if (box.clientWidth === 0) return NO_EDGES;
  return {
    start: box.scrollLeft > SLACK,
    end: box.scrollLeft + box.clientWidth < box.scrollWidth - SLACK,
  };
}

/** How far each fade reaches into the scroller. */
const FADE = space["48"];

/**
 * A mask that fades the sides hiding content, or `undefined` when nothing
 * hides. A mask reads only alpha, so it works on any surface in any theme.
 */
export function edgeMask(edges: ScrollEdges): string | undefined {
  if (!edges.start && !edges.end) return undefined;
  const left = edges.start ? `transparent, black ${FADE}` : "black, black";
  const right = edges.end
    ? `black calc(100% - ${FADE}), transparent`
    : "black, black";
  return `linear-gradient(to right, ${left}, ${right})`;
}
