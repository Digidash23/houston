import { ok } from "node:assert";
import { describe, it } from "node:test";
import {
  CARD_PADDING,
  NAME_LINES,
  NODE,
  type StackedShape,
  stackedHeight,
} from "../src/components/organization/org-chart-share-card-geometry.ts";

describe("share card content budget", () => {
  it("fits the worst case of every stacked card inside it, mark and padding included", () => {
    for (const shape of ["column", "leaf"] as StackedShape[]) {
      for (let names = 0; names <= NAME_LINES; names++) {
        const height = stackedHeight(shape, names);
        ok(
          height + CARD_PADDING * 2 <= NODE[shape].h,
          `${shape}: ${names} name lines = ${height}px in ${NODE[shape].h}px`,
        );
      }
    }
  });

  it("leaves no tall empty band: a full two-line card fills most of its height", () => {
    for (const shape of ["column", "leaf"] as StackedShape[]) {
      const full = stackedHeight(shape, NAME_LINES);
      ok(full >= NODE[shape].h * 0.8, `${shape}: ${full} of ${NODE[shape].h}`);
    }
  });

  it("fits the one-line cards", () => {
    ok(NODE.root.tile + CARD_PADDING * 2 <= NODE.root.h);
    ok(NODE.moreLeaf.name + CARD_PADDING * 2 <= NODE.moreLeaf.h);
  });
});
