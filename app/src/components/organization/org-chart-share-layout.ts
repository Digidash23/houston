import {
  CARD,
  CARD_TEXT,
  type CardBox,
  type CardLayout,
  type CardNode,
  type CardZoom,
  NODE,
} from "./org-chart-share-card-geometry.ts";
import {
  type CardWords,
  COLUMNS,
  columnSlots,
  columnsOf,
} from "./org-chart-share-columns.ts";
import type { OrgTree } from "./org-chart-tree.ts";
import {
  type Box,
  connectorPath,
  NODE_ID,
  treeEdges,
} from "./org-chart-tree-paths.ts";

/**
 * Where everything sits on the share image. Pure and DOM-free: the painter
 * only draws what this places, and the connectors come from the same path
 * module the on-screen chart uses.
 *
 * The card is square (1200 x 1200): a chart three levels deep, with each
 * person's AI Employees stacked under them, needs height more than width,
 * and a square image takes the most room LinkedIn's feed gives a post. The
 * root card sits centred under the header, the first row spreads across
 * as equal columns (`org-chart-share-columns.ts`), and each person's AI
 * Employees stack under them, then one "+N" for the rest.
 */

const TREE = {
  rootY: 252,
  rowY: 378,
  /** Space between stacked cards, which the connector spans. */
  gap: 24,
  radius: 12,
} as const;

/**
 * The room the chart is scaled into: clear of the count line above and the
 * footer below. A small team grows to fill it (up to {@link MAX_ZOOM}), so
 * three cards never sit as a speck in an empty square; a big one shrinks.
 */
const ROOM = {
  top: CARD_TEXT.countsY + 70,
  bottom: CARD_TEXT.footerY - 80,
  /** The margin the columns are laid out in, so a full row is never shrunk. */
  side: COLUMNS.margin,
} as const;
const MAX_ZOOM = 1.8;

/** Scale `boxes` (centred on the card) into {@link ROOM}. */
function zoomFor(boxes: Box[]): CardZoom {
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const roomH = ROOM.bottom - ROOM.top;
  const scale = Math.min(
    MAX_ZOOM,
    (CARD.width - ROOM.side * 2) / (right - left),
    roomH / (bottom - top),
  );
  const cx = CARD.width / 2;
  return {
    scale,
    x: cx - cx * scale,
    y: ROOM.top + (roomH - (bottom - top) * scale) / 2 - top * scale,
  };
}

export function shareCardLayout(tree: OrgTree, words: CardWords): CardLayout {
  const cx = CARD.width / 2;
  const rootNode: CardNode =
    tree.root.kind === "person"
      ? { kind: "person", person: tree.root.person }
      : { kind: "company", name: tree.root.name };
  const rootW = NODE.root.w;
  const boxes: CardBox[] = [
    {
      id: NODE_ID.root,
      node: rootNode,
      shape: "root",
      label:
        tree.root.kind === "person" ? tree.root.person.name : tree.root.name,
      x: cx - rootW / 2,
      y: TREE.rootY,
      w: rootW,
      h: NODE.root.h,
    },
  ];

  const columns = columnsOf(tree, words);
  const slots = columnSlots(columns);
  const secondRowY = TREE.rowY + NODE.column.h + COLUMNS.rowGap;
  columns.forEach((column, index) => {
    const { x, w, row } = slots[index];
    const top = row === 0 ? TREE.rowY : secondRowY;
    boxes.push({
      ...column.head,
      shape: "column",
      x,
      y: top,
      w,
      h: NODE.column.h,
    });
    let y = top + NODE.column.h + TREE.gap;
    for (const entry of column.stack) {
      const shape = entry.node.kind === "more" ? "moreLeaf" : "leaf";
      const h = NODE[shape].h;
      boxes.push({ ...entry, shape, x, y, w, h });
      y += h + TREE.gap;
    }
  });

  const byId = new Map<string, Box>(boxes.map((box) => [box.id, box]));
  const path = connectorPath(treeEdges(tree, "desktop"), byId, {
    radius: TREE.radius,
    spineInset: 0,
  });
  return { boxes, path, zoom: zoomFor(boxes) };
}
