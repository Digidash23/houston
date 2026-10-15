import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOrgChartImage,
  getOrgChartShare,
  ORG_CHART_FETCH_TIMEOUT_MS,
  ORG_CHART_GENERIC_TITLE,
  orgChartPageView,
  parseOrgChartShare,
} from "./org-chart-share";

const ID = "AbCdEfGhIjKlMnOpQrSt_-";
const RECORD = {
  id: ID,
  title: "Acme",
  imageUrl: `https://gateway.public.test/v1/org-chart-shares/${ID}/image`,
  createdAt: "2026-10-15T20:00:00Z",
};

const fetchMock = vi.fn<typeof fetch>();
const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

beforeEach(() => {
  process.env.AGENTSTORE_GATEWAY_URL = "http://gateway.cluster.test/";
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockReset();
  timeoutSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENTSTORE_GATEWAY_URL;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

type NextInit = RequestInit & { next?: { revalidate?: number } };

describe("getOrgChartShare", () => {
  it("reads the record off the in-cluster gateway, time-boxed and cached for an hour", async () => {
    fetchMock.mockResolvedValue(json(RECORD));
    await expect(getOrgChartShare(ID)).resolves.toEqual({
      kind: "found",
      share: RECORD,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `http://gateway.cluster.test/v1/org-chart-shares/${ID}`,
    );
    expect((init as NextInit).next?.revalidate).toBe(3600);
    expect(init?.cache).toBeUndefined();
    expect((init as NextInit).signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(ORG_CHART_FETCH_TIMEOUT_MS);
  });

  it("is not_found for the gateway's 404, and for an id never minted without asking", async () => {
    fetchMock.mockResolvedValue(json({ error: "not_found" }, 404));
    await expect(getOrgChartShare(ID)).resolves.toEqual({ kind: "not_found" });
    await expect(getOrgChartShare("../../v1/me")).resolves.toEqual({
      kind: "not_found",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is unavailable, never a throw, for a 5xx, a 429, no answer, a timeout or an unreadable record", async () => {
    const answers: Array<() => Promise<Response>> = [
      async () => json({ error: "boom" }, 500),
      async () => json({ error: "rate_limited" }, 429),
      async () => Promise.reject(new TypeError("fetch failed")),
      async () => Promise.reject(new DOMException("timed out", "TimeoutError")),
      async () => json({ id: ID }),
      async () => new Response("<html>", { status: 200 }),
    ];
    for (const answer of answers) {
      fetchMock.mockImplementationOnce(answer);
      await expect(getOrgChartShare(ID)).resolves.toEqual({
        kind: "unavailable",
      });
    }
  });
});

describe("getOrgChartImage", () => {
  it("reads the picture off the in-cluster gateway as a data URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
      }),
    );
    await expect(getOrgChartImage(ID)).resolves.toEqual({
      kind: "found",
      dataUrl: "data:image/png;base64,iVBORw==",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `http://gateway.cluster.test/v1/org-chart-shares/${ID}/image`,
    );
    // The PNG stays out of Next's data cache; the card's header caches it.
    expect(init?.cache).toBe("no-store");
    expect((init as NextInit).next).toBeUndefined();
    expect((init as NextInit).signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(ORG_CHART_FETCH_TIMEOUT_MS);
  });

  it("tells a missing picture from one it could not get", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "not_found" }, 404));
    await expect(getOrgChartImage(ID)).resolves.toEqual({ kind: "not_found" });
    fetchMock.mockResolvedValueOnce(json({ error: "rate_limited" }, 429));
    await expect(getOrgChartImage(ID)).resolves.toEqual({
      kind: "unavailable",
    });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(getOrgChartImage(ID)).resolves.toEqual({
      kind: "unavailable",
    });
    fetchMock.mockResolvedValueOnce(
      new Response("<html>", { headers: { "content-type": "text/html" } }),
    );
    await expect(getOrgChartImage(ID)).resolves.toEqual({
      kind: "unavailable",
    });
  });
});

describe("orgChartPageView", () => {
  it("shows the share as published", () => {
    expect(orgChartPageView({ kind: "found", share: RECORD })).toEqual({
      title: "Acme",
      imageUrl: RECORD.imageUrl,
    });
  });

  it("shows a plain title and no picture when the record could not be read", () => {
    expect(orgChartPageView({ kind: "unavailable" })).toEqual({
      title: ORG_CHART_GENERIC_TITLE,
      imageUrl: null,
    });
  });

  it("is a 404 only for a share that does not exist", () => {
    expect(orgChartPageView({ kind: "not_found" })).toBeNull();
  });
});

describe("parseOrgChartShare", () => {
  it("refuses a non-web image URL and an empty title", () => {
    expect(
      parseOrgChartShare({ ...RECORD, imageUrl: "javascript:alert(1)" }),
    ).toBeNull();
    expect(parseOrgChartShare({ ...RECORD, title: "  " })).toBeNull();
    expect(parseOrgChartShare(RECORD)).toEqual(RECORD);
  });
});
