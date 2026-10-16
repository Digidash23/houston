import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { Agent, OrgMember } from "@houston/engine-adapter";
import {
  ORG_CHART_SHARE_PREVIEW_MAX_BYTES,
  ORG_CHART_SHARE_PREVIEW_SIZE,
} from "@houston/wire-types";
import {
  type CardLayout,
  LANDSCAPE_FRAME,
  onCard,
} from "../src/components/organization/org-chart-share-card-geometry.ts";
import { COLUMNS } from "../src/components/organization/org-chart-share-columns.ts";
import {
  encodeLinkCard,
  LANDSCAPE_AGENTS,
  LinkCardError,
  landscapeTree,
} from "../src/components/organization/org-chart-share-landscape.ts";
import { shareCardLayout } from "../src/components/organization/org-chart-share-layout.ts";
import { SHARE_CARD_CAPS } from "../src/components/organization/org-chart-share-model.ts";
import { buildOrgTree } from "../src/components/organization/org-chart-tree.ts";

const FRAME = LANDSCAPE_FRAME;
const USABLE = FRAME.width - COLUMNS.margin * 2;

const agent = (id: string, userId: string): Agent => ({
  id,
  name: `Agent ${id}`,
  folderPath: id,
  configId: "c",
  createdAt: "2026-01-01",
  access: "manager",
  assignments: [{ userId, access: "user" }],
});
const roster = (n: number): OrgMember[] => [
  { userId: "owner", role: "owner", displayName: "Owner" },
  ...Array.from({ length: n - 1 }, (_, i) => ({
    userId: `u${i}`,
    role: "user" as const,
    displayName: `User ${String(i).padStart(2, "0")}`,
  })),
];
const words = {
  morePeople: (n: number) => `+${n} people`,
  moreAgents: (n: number) => `+${n} AI Employees`,
};
const tree = (agents: Agent[], members: OrgMember[], personal = false) =>
  buildOrgTree({ agents, members, name: "Acme", personal }, SHARE_CARD_CAPS);
const landscape = (agents: Agent[], members: OrgMember[], personal = false) =>
  shareCardLayout(landscapeTree(tree(agents, members, personal)), words, FRAME);

/** The chart's extent on the card. */
function extent({ boxes, zoom }: CardLayout) {
  const on = boxes.map((b) => onCard(zoom, b));
  return {
    left: Math.min(...on.map((b) => b.x)),
    right: Math.max(...on.map((b) => b.x + b.w)),
    top: Math.min(...on.map((b) => b.y)),
    bottom: Math.max(...on.map((b) => b.y + b.h)),
  };
}

/** Nine people holding forty AI Employees: a full first row of seven. */
const wide = () =>
  landscape(
    Array.from({ length: 40 }, (_, i) => agent(`a${i}`, `u${i % 9}`)),
    roster(10),
  );

describe("the landscape link card", () => {
  it("is the one size the gateway takes a card at", () => {
    deepStrictEqual(
      { width: FRAME.width, height: FRAME.height },
      { ...ORG_CHART_SHARE_PREVIEW_SIZE },
    );
  });

  it("keeps the chart between the header and the footer, inside the card", () => {
    for (const layout of [
      wide(),
      landscape([agent("a", "owner")], roster(1)),
    ]) {
      const e = extent(layout);
      ok(e.left >= COLUMNS.margin - 0.5 && e.right <= FRAME.width - 55.5);
      ok(e.top >= FRAME.room.top - 0.5, `top ${e.top}`);
      ok(e.bottom <= FRAME.room.bottom + 0.5, `bottom ${e.bottom}`);
      ok(FRAME.countsY < FRAME.room.top && FRAME.room.bottom < FRAME.footerY);
    }
  });

  it("spreads a wide team across the card instead of squeezing its row", () => {
    const layout = wide();
    const row = layout.boxes.filter((b) => b.shape === "column");
    strictEqual(row.length, 7);
    // Every card keeps its full width; the zoom shrinks the row instead.
    for (const box of row) strictEqual(box.w, COLUMNS.maxWidth);
    const e = extent(layout);
    ok(e.right - e.left > USABLE * 0.99, `width ${e.right - e.left}`);
  });

  it("stacks at most two AI Employees under a person, then the rest as +N", () => {
    const layout = wide();
    const u0 = layout.boxes.find((b) => b.id === "p:u0");
    deepStrictEqual(
      layout.boxes.filter((b) => b.x === u0?.x).map((b) => b.shape),
      ["column", "leaf", "leaf", "moreLeaf"],
    );
    const more = layout.boxes.find((b) => b.id === "more:u0");
    strictEqual(more?.node.kind === "more" && more.node.count, 3);
  });

  it("grows a tiny team to the room's height, centred", () => {
    const layout = landscape([agent("a", "owner")], roster(1));
    const e = extent(layout);
    ok(e.bottom - e.top > (FRAME.room.bottom - FRAME.room.top) * 0.99);
    ok(Math.abs((e.left + e.right) / 2 - FRAME.width / 2) < 0.001);
  });

  it("wraps five to seven flat columns onto two lines, filling the height", () => {
    const layout = landscape(
      Array.from({ length: 7 }, (_, i) => agent(`a${i}`, "owner")),
      roster(1),
      true,
    );
    const rows = new Set(
      layout.boxes.filter((b) => b.shape === "column").map((b) => b.y),
    );
    strictEqual(rows.size, 2);
    const e = extent(layout);
    ok(e.bottom - e.top > (FRAME.room.bottom - FRAME.room.top) * 0.9);
  });
});

describe("landscapeTree", () => {
  it("cuts each person's stack to two, adding the rest to their +N", () => {
    const full = tree(
      Array.from({ length: 5 }, (_, i) => agent(`a${i}`, "u0")),
      roster(2),
    );
    const cut = landscapeTree(full);
    const before = full.branches.find((b) => b.person.userId === "u0");
    const after = cut.branches.find((b) => b.person.userId === "u0");
    strictEqual(before?.agents.length, 3);
    strictEqual(before?.moreAgents, 2);
    strictEqual(after?.agents.length, LANDSCAPE_AGENTS);
    strictEqual(after?.moreAgents, 3);
    deepStrictEqual(cut.counts, full.counts);
  });
});

const bytes = (size: number, type: string) =>
  new Blob([new Uint8Array(size)], { type });

describe("encodeLinkCard", () => {
  it("keeps a PNG right at the cap", async () => {
    const asked: string[] = [];
    const card = await encodeLinkCard(async (type) => {
      asked.push(type);
      return bytes(ORG_CHART_SHARE_PREVIEW_MAX_BYTES, type);
    });
    strictEqual(card.type, "image/png");
    deepStrictEqual(asked, ["image/png"]);
  });

  it("goes up as a JPEG when the PNG is over the cap", async () => {
    const card = await encodeLinkCard(async (type) =>
      bytes(
        type === "image/png" ? ORG_CHART_SHARE_PREVIEW_MAX_BYTES + 1 : 500_000,
        type,
      ),
    );
    strictEqual(card.type, "image/jpeg");
  });

  it("is no card when even the JPEG is over the cap", async () => {
    await rejects(
      encodeLinkCard(async (type) =>
        bytes(ORG_CHART_SHARE_PREVIEW_MAX_BYTES + 1, type),
      ),
      LinkCardError,
    );
  });
});
