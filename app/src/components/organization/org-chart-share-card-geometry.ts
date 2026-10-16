import type { ChartPerson } from "./org-chart-people.ts";
import type { OrgTreeAgent } from "./org-chart-tree.ts";
import type { Box } from "./org-chart-tree-paths.ts";

/**
 * The share image's fixed frame and the shapes its layout hands the
 * painter. Pure and DOM-free.
 */

/**
 * A frame the chart is drawn in: its size, its header (the name, then the
 * counts) and footer (the mark and the site), and the band the chart is
 * zoomed into between them. The chart itself is laid out once, in a
 * 1200-unit-wide space, and zoomed to fill the frame's room.
 */
export interface CardFrame {
  width: number;
  height: number;
  /** The margin the header and the footer sit in. */
  pad: number;
  /** Baselines of the name, the counts and the footer. */
  titleY: number;
  countsY: number;
  footerY: number;
  /** The name shrinks from `title` to `titleMin` px before it is cut. */
  type: {
    title: number;
    titleMin: number;
    tracking: number;
    counts: number;
    site: number;
    /** The Houston mark's height. */
    mark: number;
  };
  /** The band the chart is zoomed into, clear of the header and footer. */
  room: { top: number; bottom: number };
  /** How far a small team grows to fill the room. */
  maxZoom: number;
  /**
   * Whether the first row squeezes into the 1200 units (the square, which
   * has height to spare) or runs at full card width and the zoom shrinks
   * it instead (the landscape link card, which has width to spare).
   */
  squeeze: boolean;
}

/** The square share image. */
export const SQUARE_FRAME: CardFrame = {
  width: 1200,
  height: 1200,
  pad: 88,
  titleY: 160,
  countsY: 210,
  footerY: 1128,
  type: {
    title: 84,
    titleMin: 52,
    tracking: -2.5,
    counts: 30,
    site: 22,
    mark: 28,
  },
  room: { top: 280, bottom: 1048 },
  maxZoom: 1.8,
  squeeze: true,
};

/**
 * The 1200 x 630 link card LinkedIn previews the chart's page with: the
 * same chart, header and footer, scaled for the shorter frame.
 */
export const LANDSCAPE_FRAME: CardFrame = {
  width: 1200,
  height: 630,
  pad: 56,
  titleY: 86,
  countsY: 124,
  footerY: 598,
  type: {
    title: 50,
    titleMin: 34,
    tracking: -1.5,
    counts: 22,
    site: 17,
    mark: 21,
  },
  room: { top: 156, bottom: 560 },
  maxZoom: 1.4,
  squeeze: false,
};

/** The width the chart is laid out in, before a frame zooms it. */
export const CHART_WIDTH = 1200;

/**
 * The node shapes. `root` is a wide card with a tile and the name; `column`
 * (the first row: people, a personal space's AI Employees, "+N") stacks a
 * 56px mark (a face, or an AI Employee's helmet avatar) over the name;
 * `leaf` (an AI Employee under its person) stacks a smaller helmet avatar
 * over the name. Every stacked card centres what it holds, and a name takes
 * at most {@link NAME_LINES} lines, so the worst case still fits inside the
 * card. The type sizes stay legible when LinkedIn shows the image around
 * 550px wide (0.46x): a 24px name lands near 11px.
 */
export const NODE = {
  root: { h: 80, w: 420, tile: 44, name: 28 },
  column: {
    h: 140,
    mark: 56,
    gap: 12,
    name: 24,
    nameLine: 28,
  },
  leaf: {
    h: 96,
    mark: 30,
    gap: 8,
    name: 21,
    nameLine: 25,
  },
  moreLeaf: { h: 48, name: 21 },
} as const;

/** The least room left between a stacked card's content and its edges. */
export const CARD_PADDING = 4;

export type StackedShape = "column" | "leaf";

/** A name may take two lines. */
export const NAME_LINES = 2;

/** How tall a stacked card's content is, mark included. */
export function stackedHeight(shape: StackedShape, nameLines: number): number {
  const s = NODE[shape];
  return s.mark + (nameLines > 0 ? s.gap + nameLines * s.nameLine : 0);
}

export type CardNode =
  | { kind: "company"; name: string }
  | { kind: "person"; person: ChartPerson }
  | { kind: "agent"; agent: OrgTreeAgent }
  | { kind: "more"; count: number };

export type CardShape = "root" | "column" | "leaf" | "moreLeaf";

export interface CardBox extends Box {
  id: string;
  node: CardNode;
  shape: CardShape;
  /** The name, wrapped and cut to the card's width when painted. */
  label?: string;
}

/** Card point = chart point x scale + (x, y). */
export interface CardZoom {
  scale: number;
  x: number;
  y: number;
}

export interface CardLayout {
  /** In chart units; {@link CardLayout.zoom} places them on the card. */
  boxes: CardBox[];
  /** Every connector as one SVG path, for `Path2D`, in chart units. */
  path: string;
  zoom: CardZoom;
}

/** Where `box` lands on the card once zoomed. */
export function onCard(zoom: CardZoom, box: Box): Box {
  return {
    x: box.x * zoom.scale + zoom.x,
    y: box.y * zoom.scale + zoom.y,
    w: box.w * zoom.scale,
    h: box.h * zoom.scale,
  };
}
