import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  graphemes,
  type Measurer,
} from "../src/components/organization/org-chart-share-card-text.ts";
import {
  LINK_CARD,
  LINK_CARD_TYPE,
  linkCardLayout,
} from "../src/components/organization/org-chart-share-link-card-layout.ts";

/** Half the font size per character, so widths follow the font in use. */
const ctx: Measurer = {
  font: "",
  measureText(text) {
    const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
    return { width: graphemes(text).length * size * 0.5 };
  },
};

const EN = {
  tagline: "AI Employees working in Houston",
  call: "Build your AI team · gethouston.ai",
};

describe("linkCardLayout", () => {
  it("is LinkedIn's 1.91:1 card", () => {
    deepStrictEqual(LINK_CARD, { width: 1200, height: 630 });
  });

  it("insets the square chart 28px on the left, top and bottom", () => {
    const { chart } = linkCardLayout(ctx, EN);
    deepStrictEqual(chart, { x: 28, y: 28, size: 574, radius: 18 });
    strictEqual(chart.y + chart.size, LINK_CARD.height - 28);
  });

  it("sets the words in a column right of the chart, inside the card", () => {
    const { chart, column } = linkCardLayout(ctx, EN);
    strictEqual(column.x, chart.x + chart.size + 56);
    strictEqual(column.x + column.width, LINK_CARD.width - 44);
  });

  it("wraps the tagline within the column and keeps the call under it", () => {
    const layout = linkCardLayout(ctx, EN);
    const { tagline, call, column } = layout;
    ok(tagline.lines.length >= 2, tagline.lines.join(" / "));
    for (const [text, font] of [
      [tagline, LINK_CARD_TYPE.tagline.size],
      [call, LINK_CARD_TYPE.call.size],
    ] as const)
      for (const line of text.lines)
        ok(graphemes(line).length * font * 0.5 <= column.width, line);
    deepStrictEqual(tagline.lines.join(" "), EN.tagline);
    deepStrictEqual(call.lines, [EN.call]);
    const lastTagline = tagline.baselines.at(-1) ?? 0;
    ok((call.baselines[0] ?? 0) - lastTagline >= LINK_CARD_TYPE.gap);
  });

  it("centres the block on the card's height", () => {
    const { tagline, call } = linkCardLayout(ctx, EN);
    const top = (tagline.baselines[0] ?? 0) - LINK_CARD_TYPE.tagline.line * 0.8;
    const bottom =
      (call.baselines.at(-1) ?? 0) + LINK_CARD_TYPE.call.line * 0.2;
    ok(Math.abs(top - (LINK_CARD.height - bottom)) < 0.001, `${top}`);
  });

  it("cuts words that run long at their line caps, inside the card", () => {
    const long = {
      tagline: "Funcionários de IA trabalhando no Houston ".repeat(6),
      call: "Monte sua equipe de IA · gethouston.ai ".repeat(6),
    };
    const { tagline, call } = linkCardLayout(ctx, long);
    strictEqual(tagline.lines.length, LINK_CARD_TYPE.tagline.maxLines);
    strictEqual(call.lines.length, LINK_CARD_TYPE.call.maxLines);
    ok(call.lines.at(-1)?.endsWith("…"));
    ok((tagline.baselines[0] ?? 0) > 0);
    ok((call.baselines.at(-1) ?? 0) < LINK_CARD.height);
  });
});
