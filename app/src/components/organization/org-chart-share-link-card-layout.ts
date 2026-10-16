import { ORG_CHART_SHARE_PREVIEW_SIZE } from "@houston/wire-types";
import { FONT, type Measurer, wrapLines } from "./org-chart-share-card-text.ts";

/**
 * Where everything on the link card sits: the 1200 x 630 picture LinkedIn
 * shows as the shared page's preview. LinkedIn crops a link's preview to
 * 1.91:1 and the chart is square, so the chart sits inset on the left, on
 * the same dotted paper it was drawn on, and the right says what it is. The
 * chart already carries the team's name, so the words never repeat it.
 * Pure: it only needs something that measures.
 */

/** The one size the gateway takes a card at (anything else is refused). */
export const LINK_CARD = ORG_CHART_SHARE_PREVIEW_SIZE;

/** The gap between the card's edge and the chart. */
const INSET = 28;
/** The text column's padding: from the chart, and from the card's right edge. */
const TEXT_PAD = { left: 56, right: 44 } as const;

export const LINK_CARD_TYPE = {
  tagline: { size: 54, weight: 400, line: 58, tracking: -1.5, maxLines: 3 },
  call: { size: 26, weight: 400, line: 35, tracking: 0, maxLines: 2 },
  /** Between the tagline's last line and the call's first. */
  gap: 24,
} as const;

export interface LinkCardWords {
  tagline: string;
  call: string;
}

export interface LinkCardLines {
  font: string;
  tracking: number;
  lines: string[];
  /** One baseline per line. */
  baselines: number[];
}

export interface LinkCardLayout {
  chart: { x: number; y: number; size: number; radius: number };
  /** The text column's left edge and width. */
  column: { x: number; width: number };
  tagline: LinkCardLines;
  call: LinkCardLines;
}

type Role = Exclude<keyof typeof LINK_CARD_TYPE, "gap">;

function fontOf(role: Role): string {
  const { size, weight } = LINK_CARD_TYPE[role];
  return `${weight} ${size}px ${FONT}`;
}

function wrap(ctx: Measurer, role: Role, text: string, width: number) {
  ctx.font = fontOf(role);
  return wrapLines(ctx, text, width, LINK_CARD_TYPE[role].maxLines);
}

/**
 * The card's layout for `words`. The tagline and the call stack as one block,
 * centred on the chart's middle; a line sits on a baseline 80% down its line
 * box, so a single line reads as centred.
 */
export function linkCardLayout(
  ctx: Measurer,
  words: LinkCardWords,
): LinkCardLayout {
  const size = LINK_CARD.height - INSET * 2;
  const x = INSET + size + TEXT_PAD.left;
  const width = LINK_CARD.width - TEXT_PAD.right - x;
  const tagline = wrap(ctx, "tagline", words.tagline, width);
  const call = wrap(ctx, "call", words.call, width);
  const { tagline: big, call: small, gap } = LINK_CARD_TYPE;
  const height = tagline.length * big.line + gap + call.length * small.line;
  const top = (LINK_CARD.height - height) / 2;
  const callTop = top + tagline.length * big.line + gap;
  const baselines = (from: number, count: number, line: number) =>
    Array.from({ length: count }, (_, i) => from + i * line + line * 0.8);
  return {
    chart: { x: INSET, y: INSET, size, radius: 18 },
    column: { x, width },
    tagline: {
      font: fontOf("tagline"),
      tracking: big.tracking,
      lines: tagline,
      baselines: baselines(top, tagline.length, big.line),
    },
    call: {
      font: fontOf("call"),
      tracking: small.tracking,
      lines: call,
      baselines: baselines(callTop, call.length, small.line),
    },
  };
}
