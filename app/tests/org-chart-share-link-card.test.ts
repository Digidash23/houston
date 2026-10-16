import { deepStrictEqual, rejects, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  ORG_CHART_SHARE_PREVIEW_MAX_BYTES,
  ORG_CHART_SHARE_PREVIEW_SIZE,
} from "@houston/wire-types";
import {
  encodeLinkCard,
  type LinkCardCanvas,
  LinkCardError,
  paintLinkCard,
} from "../src/components/organization/org-chart-share-link-card.ts";

const WORDS = {
  tagline: "AI Employees working in Houston",
  call: "Build your AI team · gethouston.ai",
};

const bytes = (size: number, type: string) =>
  new Blob([new Uint8Array(size)], { type });

/**
 * A 2D context that takes every call and measures half the font size per
 * character, enough for the card to lay itself out and paint.
 */
function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { font: "10px sans-serif" };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText")
        return (text: string) => ({
          width:
            text.length *
            Number(/(\d+)px/.exec(String(target.font))?.[1] ?? 10) *
            0.5,
        });
      if (key === "getTransform") return () => ({ a: 1, d: 1 });
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** A canvas that records the size it was encoded at, and each encoding asked for. */
function fakeCanvas(sizes: Record<string, number>) {
  const encoded: { type: string; width: number; height: number }[] = [];
  const canvas: LinkCardCanvas = {
    width: 300,
    height: 150,
    getContext: () => fakeContext(),
    toBlob(done, type) {
      encoded.push({ type, width: canvas.width, height: canvas.height });
      done(bytes(sizes[type] ?? 0, type));
    },
  };
  return { canvas, encoded };
}

const CHART = {} as CanvasImageSource;

describe("paintLinkCard", () => {
  it("encodes the card at exactly the size the gateway takes", async () => {
    const { canvas, encoded } = fakeCanvas({ "image/png": 1000 });
    const card = await paintLinkCard(canvas, CHART, WORDS);
    strictEqual(card.type, "image/png");
    deepStrictEqual(encoded, [{ type: "image/png", width: 1200, height: 630 }]);
    deepStrictEqual(
      { width: encoded[0]?.width, height: encoded[0]?.height },
      { ...ORG_CHART_SHARE_PREVIEW_SIZE },
    );
  });

  it("goes up as a JPEG when the PNG is over the gateway's cap", async () => {
    const { canvas, encoded } = fakeCanvas({
      "image/png": ORG_CHART_SHARE_PREVIEW_MAX_BYTES + 1,
      "image/jpeg": 500_000,
    });
    const card = await paintLinkCard(canvas, CHART, WORDS);
    strictEqual(card.type, "image/jpeg");
    deepStrictEqual(
      encoded.map((e) => [e.type, e.width, e.height]),
      [
        ["image/png", 1200, 630],
        ["image/jpeg", 1200, 630],
      ],
    );
  });
});

describe("encodeLinkCard", () => {
  it("keeps a PNG right at the cap", async () => {
    const card = await encodeLinkCard(async (type) =>
      bytes(ORG_CHART_SHARE_PREVIEW_MAX_BYTES, type),
    );
    strictEqual(card.type, "image/png");
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
