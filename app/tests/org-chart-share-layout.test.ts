import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { Agent, OrgMember } from "@houston/engine-adapter";
import {
  SQUARE_FRAME as CARD,
  type CardBox,
  onCard,
} from "../src/components/organization/org-chart-share-card-geometry.ts";
import { shareCardLayout } from "../src/components/organization/org-chart-share-layout.ts";
import { SHARE_CARD_CAPS } from "../src/components/organization/org-chart-share-model.ts";
import { buildOrgTree } from "../src/components/organization/org-chart-tree.ts";
import type { Box } from "../src/components/organization/org-chart-tree-paths.ts";

const agent = (id: string, userId?: string): Agent => ({
  id,
  name: `Agent ${id}`,
  folderPath: id,
  configId: "c",
  createdAt: "2026-01-01",
  access: "manager",
  assignments: userId ? [{ userId, access: "user" }] : undefined,
});
const roster = (n: number): OrgMember[] => [
  { userId: "owner", role: "owner", displayName: "Owner" },
  ...Array.from({ length: n - 1 }, (_, i) => ({
    userId: `u${i}`,
    role: "user" as const,
    displayName: `User ${String(i).padStart(2, "0")}`,
  })),
];
const layout = (agents: Agent[], members: OrgMember[], personal = false) =>
  shareCardLayout(
    buildOrgTree({ agents, members, name: "Acme", personal }, SHARE_CARD_CAPS),
    {
      morePeople: (n) => `+${n} people`,
      moreAgents: (n) => `+${n} AI Employees`,
    },
  );

/** Every coordinate a path visits. */
const pathPoints = (d: string) =>
  [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);

function noOverlaps(boxes: CardBox[]) {
  for (const a of boxes)
    for (const b of boxes) {
      if (a === b) continue;
      const apart =
        a.x + a.w <= b.x ||
        b.x + b.w <= a.x ||
        a.y + a.h <= b.y ||
        b.y + b.h <= a.y;
      ok(apart, `${a.id} overlaps ${b.id}`);
    }
}

/**
 * Whether any run of `path` passes through a card. Each `M` starts a new
 * edge; a rounded corner's control point stands in for its curve.
 */
function crossesCard(path: string, boxes: Box[]): boolean {
  const inside = (box: Box, x: number, y: number) =>
    x > box.x + 0.5 &&
    x < box.x + box.w - 0.5 &&
    y > box.y + 0.5 &&
    y < box.y + box.h - 0.5;
  for (const edge of path.split("M").filter(Boolean)) {
    const points = pathPoints(`M${edge}`);
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      for (let t = 0; t <= 1; t += 0.05)
        if (
          boxes.some((b) => inside(b, ax + (bx - ax) * t, ay + (by - ay) * t))
        )
          return true;
    }
  }
  return false;
}

const big = () =>
  layout(
    Array.from({ length: 30 }, (_, i) => agent(`a${i}`, `u${i % 9}`)),
    roster(10),
  );

describe("shareCardLayout", () => {
  it("keeps every card inside the card, between the header and the footer, without overlaps", () => {
    const { boxes, zoom } = big();
    for (const box of boxes.map((b) => ({ ...b, ...onCard(zoom, b) }))) {
      ok(box.x >= 0 && box.x + box.w <= CARD.width, `x ${box.id}`);
      ok(box.y > CARD.countsY + 20, `top ${box.id}`);
      ok(box.y + box.h < CARD.footerY - 40, `bottom ${box.id}`);
    }
    noOverlaps(boxes);
  });

  it("only draws lines between cards, never past the outermost ones", () => {
    const { boxes, path } = big();
    ok(path.length > 0);
    const left = Math.min(...boxes.slice(1).map((b) => b.x + b.w / 2));
    const right = Math.max(...boxes.slice(1).map((b) => b.x + b.w / 2));
    for (const [x, y] of pathPoints(path)) {
      ok(x >= left - 0.5 && x <= right + 0.5, `x ${x}`);
      ok(y >= boxes[0].y + boxes[0].h - 0.5, `y ${y}`);
      ok(y < Math.max(...boxes.map((b) => b.y + b.h)) + 0.5, `y ${y}`);
    }
  });

  it("draws six people and a +N, each with three AI Employees and a +N", () => {
    const { boxes } = big();
    strictEqual(boxes.filter((b) => b.node.kind === "person").length, 6);
    // The owner is always on the card, and the people left out are counted:
    // 9 users hold 30 agents, 5 are shown, 4 are left out.
    ok(
      boxes.some(
        (b) => b.node.kind === "person" && b.node.person.userId === "owner",
      ),
    );
    const peopleMore = boxes.find((b) => b.id === "more:people");
    strictEqual(peopleMore?.label, "+4 people");
    const u0 = boxes.find((b) => b.id === "p:u0");
    const column = boxes.filter((b) => b.x === u0?.x);
    // User 00 holds four: three shown, then the "+1".
    deepStrictEqual(
      column.map((b) => b.shape),
      ["column", "leaf", "leaf", "leaf", "moreLeaf"],
    );
  });

  it("grows a small team to fill the card, and leaves a full one at its size", () => {
    const small = layout([agent("a", "owner"), agent("b", "owner")], roster(1));
    ok(small.zoom.scale > 1.5, `small ${small.zoom.scale}`);
    const [root] = small.boxes.map((b) => onCard(small.zoom, b));
    strictEqual(root.x + root.w / 2, CARD.width / 2);
    // A full row already spans the card: it is never shrunk below 1. Six
    // people with one AI Employee each, then "+2 people".
    const wide = layout(
      Array.from({ length: 8 }, (_, i) => agent(`a${i}`, `u${i - 1}`)),
      roster(9),
    );
    const row = wide.boxes.filter((b) => b.shape === "column");
    strictEqual(row.length, 7);
    strictEqual(new Set(row.map((b) => b.y)).size, 1);
    noOverlaps(wide.boxes);
    ok(Math.abs(wide.zoom.scale - 1) < 1e-9, `wide ${wide.zoom.scale}`);
    const large = big();
    ok(large.zoom.scale <= 1 + 1e-9, `big ${large.zoom.scale}`);
  });

  it("centres a lone branch under the root with a straight line", () => {
    const { boxes, path } = layout([agent("a")], roster(1));
    const centre = CARD.width / 2;
    for (const box of boxes) strictEqual(box.x + box.w / 2, centre);
    ok(
      pathPoints(path).every(([x]) => x === centre),
      path,
    );
  });

  it("lays a personal space out as its person over a row of AI Employees", () => {
    const agents = Array.from({ length: 8 }, (_, i) => agent(`a${i}`));
    const { boxes } = layout(agents, roster(1), true);
    strictEqual(boxes[0].node.kind, "person");
    strictEqual(boxes[0].shape, "root");
    strictEqual(boxes.filter((b) => b.node.kind === "agent").length, 6);
    deepStrictEqual(boxes.find((b) => b.node.kind === "more")?.node, {
      kind: "more",
      count: 2,
    });
    ok(boxes.slice(1).every((b) => b.shape === "column"));
  });

  it("labels every card with its name alone, never a role", () => {
    const { boxes } = layout(
      [{ ...agent("a"), role: "Inbox keeper" }],
      roster(1),
    );
    const person = boxes.find((b) => b.node.kind === "person");
    const ai = boxes.find((b) => b.node.kind === "agent");
    strictEqual(person?.label, "Owner");
    strictEqual(ai?.label, "Agent a");
    for (const box of boxes) ok(!("sublabel" in box), box.id);
    strictEqual(boxes[0].label, "Acme");
  });

  it("wraps five to seven AI Employees onto two lines, the second in the first's gaps", () => {
    const rows = (agents: number) => {
      const { boxes, path, zoom } = layout(
        Array.from({ length: agents }, (_, i) => agent(`a${i}`)),
        roster(1),
        true,
      );
      const cards = boxes.slice(1);
      const tops = [...new Set(cards.map((b) => b.y))].sort((a, b) => a - b);
      return {
        boxes,
        path,
        zoom,
        first: cards.filter((b) => b.y === tops[0]),
        second: cards.filter((b) => b.y === tops[1]),
      };
    };
    strictEqual(rows(4).second.length, 0);
    // 8 AI Employees show as six and a "+2": seven columns.
    for (const [agents, across, below] of [
      [5, 3, 2],
      [6, 4, 2],
      [8, 4, 3],
    ]) {
      const { boxes, path, zoom, first, second } = rows(agents);
      strictEqual(first.length, across, `${agents} first`);
      strictEqual(second.length, below, `${agents} second`);
      noOverlaps(boxes);
      ok(!crossesCard(path, boxes), `${agents} line through a card`);
      ok(zoom.scale > 1 - 1e-9, `${agents} never shrinks ${zoom.scale}`);
      const centre = CARD.width / 2;
      const mid = (b: Box) => b.x + b.w / 2;
      // Symmetric about the root, and every second-line card's line drops
      // through a gap: clear of every card above it.
      const offsets = second.map((b) => mid(b) - centre);
      for (const offset of offsets)
        ok(
          offsets.some((o) => Math.abs(o + offset) < 1e-9),
          `${agents} sym`,
        );
      for (const b of second)
        for (const above of first)
          ok(
            mid(b) > above.x + above.w + 20 || mid(b) < above.x - 20,
            `${agents} ${b.id} under ${above.id}`,
          );
    }
  });

  it("wraps a team whose people have no AI Employees yet the same way", () => {
    const { boxes, path } = layout([], roster(6));
    const people = boxes.filter((b) => b.node.kind === "person");
    strictEqual(people.length, 6);
    deepStrictEqual(
      [...new Set(people.map((b) => b.y))].map(
        (y) => people.filter((b) => b.y === y).length,
      ),
      [4, 2],
    );
    ok(!crossesCard(path, boxes));
  });
});
