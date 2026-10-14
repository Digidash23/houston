import {
  CARD,
  CARD_TEXT,
  type CardBox,
  type CardLayout,
  type CardNode,
  type CardZoom,
  NODE,
} from "./org-chart-share-card-geometry.ts";
import type { OrgTree, OrgTreeAgent } from "./org-chart-tree.ts";
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
 * as equal columns, and each person's AI Employees stack under them, then
 * one "+N" for the rest.
 */

const TREE = {
  rootY: 252,
  rowY: 378,
  /** Space between stacked cards, which the connector spans. */
  gap: 24,
  maxColumn: 236,
  columnGap: 14,
  margin: 56,
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
  side: TREE.margin,
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

/** The words the layout writes on cards, all authored `t()` copy. */
export interface CardWords {
  /** "+4 people". */
  morePeople: (count: number) => string;
  /** "+9 AI Employees". */
  moreAgents: (count: number) => string;
}

interface Column {
  head: Omit<CardBox, "x" | "y" | "w" | "h" | "shape">;
  stack: Omit<CardBox, "x" | "y" | "w" | "h" | "shape">[];
}

function columnsOf(tree: OrgTree, words: CardWords): Column[] {
  type Entry = Column["head"];
  const agentEntry = (agent: OrgTreeAgent): Entry => ({
    id: NODE_ID.agent(agent.id),
    node: { kind: "agent", agent },
    label: agent.name,
  });
  const more = (id: string, count: number): Entry => ({
    id,
    node: { kind: "more", count } as CardNode,
  });
  const columns: Column[] = tree.branches.map((branch) => {
    const stack = branch.agents.map(agentEntry);
    if (branch.moreAgents > 0)
      stack.push(
        more(NODE_ID.moreAgents(branch.person.userId), branch.moreAgents),
      );
    return {
      head: {
        id: NODE_ID.person(branch.person.userId),
        node: { kind: "person", person: branch.person },
        label: branch.person.name,
      },
      stack,
    };
  });
  // The people the cap left out. The header's count line still holds the
  // AI Employees they bring.
  if (tree.morePeople > 0)
    columns.push({
      head: {
        ...more(NODE_ID.morePeople, tree.morePeople),
        label: words.morePeople(tree.morePeople),
      },
      stack: [],
    });
  for (const agent of tree.rootAgents)
    columns.push({ head: agentEntry(agent), stack: [] });
  if (tree.moreRootAgents > 0)
    columns.push({
      head: {
        ...more(NODE_ID.moreRoot, tree.moreRootAgents),
        label: words.moreAgents(tree.moreRootAgents),
      },
      stack: [],
    });
  return columns;
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
  const n = columns.length;
  const usable = CARD.width - TREE.margin * 2 - TREE.columnGap * (n - 1);
  const w = Math.min(TREE.maxColumn, usable / Math.max(n, 1));
  const left = cx - (w * n + TREE.columnGap * (n - 1)) / 2;

  columns.forEach((column, index) => {
    const x = left + index * (w + TREE.columnGap);
    boxes.push({
      ...column.head,
      shape: "column",
      x,
      y: TREE.rowY,
      w,
      h: NODE.column.h,
    });
    let y = TREE.rowY + NODE.column.h + TREE.gap;
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
