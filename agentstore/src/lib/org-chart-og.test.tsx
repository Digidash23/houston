import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { OgChartCard } from "./og-chart-card";
import {
  FALLBACK_CACHE_CONTROL,
  OrgChartFallbackCard,
  orgChartOgImage,
} from "./org-chart-og";

const ID = "AbCdEfGhIjKlMnOpQrSt_-";
const DATA = "data:image/png;base64,iVBORw==";
/** What Next 15.5 stamps on every `ImageResponse`. */
const IMMUTABLE = "public, immutable, no-transform, max-age=31536000";

vi.spyOn(console, "error").mockImplementation(() => {});

/** A renderer that records which card it drew; `fail` throws for that card. */
function renderer(fail?: (card: ReactElement) => boolean) {
  const drawn: unknown[] = [];
  const render = (card: ReactElement) => {
    drawn.push(card.type);
    if (fail?.(card)) throw new Error("satori choked");
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png", "cache-control": IMMUTABLE },
    });
  };
  return { drawn, render };
}

describe("orgChartOgImage", () => {
  it("draws the chart on its card when the picture is there", async () => {
    const { drawn, render } = renderer();
    const res = await orgChartOgImage(ID, {
      image: async () => ({ kind: "found", dataUrl: DATA }),
      render,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(drawn).toEqual([OgChartCard]);
  });

  it("answers the branded card for an unknown share and an unreachable gateway", async () => {
    for (const kind of ["not_found", "unavailable"] as const) {
      const { drawn, render } = renderer();
      const res = await orgChartOgImage(ID, {
        image: async () => ({ kind }),
        render,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(FALLBACK_CACHE_CONTROL);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(drawn).toEqual([OrgChartFallbackCard]);
    }
  });

  it("answers the branded card when reading or drawing the chart throws", async () => {
    const broken = renderer();
    await expect(
      orgChartOgImage(ID, {
        image: () => Promise.reject(new Error("boom")),
        render: broken.render,
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(broken.drawn).toEqual([OrgChartFallbackCard]);

    const choking = renderer((card) => card.type === OgChartCard);
    const res = await orgChartOgImage(ID, {
      image: async () => ({ kind: "found", dataUrl: DATA }),
      render: choking.render,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(choking.drawn).toEqual([OgChartCard, OrgChartFallbackCard]);
  });
});
