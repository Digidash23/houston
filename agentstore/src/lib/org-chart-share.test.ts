import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOrgChartShare,
  ORG_CHART_FETCH_TIMEOUT_MS,
  OrgChartUnavailableError,
  orgChartPageShare,
  orgChartPreviewImage,
  parseOrgChartShare,
} from "./org-chart-share";

const ID = "AbCdEfGhIjKlMnOpQrSt_-";
const WIRE = {
  id: ID,
  title: "Acme",
  imageUrl: `https://gateway.public.test/v1/org-chart-shares/${ID}/image`,
  createdAt: "2026-10-15T20:00:00Z",
};
const PREVIEW = `https://gateway.public.test/v1/org-chart-shares/${ID}/preview`;
const RECORD = { ...WIRE, previewUrl: null };

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
  it("reads the record fresh off the in-cluster gateway, time-boxed", async () => {
    fetchMock.mockResolvedValue(json(WIRE));
    await expect(getOrgChartShare(ID)).resolves.toEqual({
      kind: "found",
      share: RECORD,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `http://gateway.cluster.test/v1/org-chart-shares/${ID}`,
    );
    // Next's data cache would keep a purged share's 200: an upstream 404
    // never replaces a cached 200.
    expect(init?.cache).toBe("no-store");
    expect((init as NextInit).next).toBeUndefined();
    expect((init as NextInit).signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(ORG_CHART_FETCH_TIMEOUT_MS);
  });

  it("reads the link card's address when the share has one", async () => {
    fetchMock.mockResolvedValue(json({ ...WIRE, previewUrl: PREVIEW }));
    await expect(getOrgChartShare(ID)).resolves.toEqual({
      kind: "found",
      share: { ...WIRE, previewUrl: PREVIEW },
    });
  });

  it("is not_found once the gateway forgets a share it answered before", async () => {
    fetchMock
      .mockResolvedValueOnce(json(WIRE))
      .mockResolvedValueOnce(json({ error: "not_found" }, 404));
    await expect(getOrgChartShare(ID)).resolves.toMatchObject({
      kind: "found",
    });
    await expect(getOrgChartShare(ID)).resolves.toEqual({ kind: "not_found" });
    for (const [, init] of fetchMock.mock.calls)
      expect(init?.cache).toBe("no-store");
  });

  it("is not_found for the gateway's 404, and for an id never minted without asking", async () => {
    fetchMock.mockResolvedValue(json({ error: "not_found" }, 404));
    await expect(getOrgChartShare(ID)).resolves.toEqual({ kind: "not_found" });
    await expect(getOrgChartShare("../../v1/me")).resolves.toEqual({
      kind: "not_found",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks once more after a failed read, and takes the second answer", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "boom" }, 502))
      .mockResolvedValueOnce(json(WIRE));
    await expect(getOrgChartShare(ID)).resolves.toEqual({
      kind: "found",
      share: RECORD,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is unavailable, never a throw, when both reads fail", async () => {
    const answers: Array<() => Promise<Response>> = [
      async () => json({ error: "boom" }, 500),
      async () => json({ error: "rate_limited" }, 429),
      async () => Promise.reject(new TypeError("fetch failed")),
      async () => Promise.reject(new DOMException("timed out", "TimeoutError")),
      async () => json({ id: ID }),
      async () => new Response("<html>", { status: 200 }),
      // A record for another share must never stand in for this one.
      async () => json({ ...WIRE, id: "ZZZZZZZZZZZZZZZZZZZZZZ" }),
    ];
    for (const answer of answers) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(answer);
      await expect(getOrgChartShare(ID)).resolves.toEqual({
        kind: "unavailable",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });
});

describe("orgChartPageShare", () => {
  it("shows the share as published, and is a 404 only for one that does not exist", () => {
    expect(orgChartPageShare(ID, { kind: "found", share: RECORD })).toEqual(
      RECORD,
    );
    expect(orgChartPageShare(ID, { kind: "not_found" })).toBeNull();
  });

  it("throws for a record it could not read, so the page answers 5xx", () => {
    expect(() => orgChartPageShare(ID, { kind: "unavailable" })).toThrow(
      OrgChartUnavailableError,
    );
  });
});

describe("orgChartPreviewImage", () => {
  it("previews with the 1200 x 630 card", () => {
    expect(orgChartPreviewImage({ ...RECORD, previewUrl: PREVIEW })).toEqual({
      url: PREVIEW,
      width: 1200,
      height: 630,
      alt: "Acme: AI Employees working in Houston",
    });
  });

  it("falls back to the square chart for a share with no card", () => {
    expect(orgChartPreviewImage(RECORD)).toEqual({
      url: RECORD.imageUrl,
      width: 1200,
      height: 1200,
      alt: "Acme: AI Employees working in Houston",
    });
  });
});

describe("parseOrgChartShare", () => {
  it("refuses a non-web image or preview URL and an empty title", () => {
    expect(
      parseOrgChartShare({ ...WIRE, imageUrl: "javascript:alert(1)" }),
    ).toBeNull();
    expect(
      parseOrgChartShare({ ...WIRE, previewUrl: "javascript:alert(1)" }),
    ).toBeNull();
    expect(parseOrgChartShare({ ...WIRE, title: "  " })).toBeNull();
    expect(parseOrgChartShare(WIRE)).toEqual(RECORD);
  });

  it("reads a null preview as a share with no card", () => {
    expect(parseOrgChartShare({ ...WIRE, previewUrl: null })).toEqual(RECORD);
  });
});
