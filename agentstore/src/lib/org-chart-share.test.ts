import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrgChartShare, parseOrgChartShare } from "./org-chart-share";

const ID = "AbCdEfGhIjKlMnOpQrSt_-";
const RECORD = {
  id: ID,
  title: "Acme",
  imageUrl: `https://gw.test/v1/org-chart-shares/${ID}/image`,
  createdAt: "2026-10-15T20:00:00Z",
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  process.env.AGENTSTORE_GATEWAY_URL = "https://gw.test/";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
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

describe("getOrgChartShare", () => {
  it("reads the public record off the gateway, cached for an hour", async () => {
    fetchMock.mockResolvedValue(json(RECORD));
    await expect(getOrgChartShare(ID)).resolves.toEqual(RECORD);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://gw.test/v1/org-chart-shares/${ID}`);
    expect(
      (init as RequestInit & { next?: { revalidate?: number } }).next
        ?.revalidate,
    ).toBe(3600);
  });

  it("answers null for an unknown share, and for an id never minted without asking", async () => {
    fetchMock.mockResolvedValue(json({ error: "not_found" }, 404));
    await expect(getOrgChartShare(ID)).resolves.toBeNull();
    await expect(getOrgChartShare("../../v1/me")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a gateway failure and an unreadable record", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "boom" }, 500));
    await expect(getOrgChartShare(ID)).rejects.toThrow(/500/);
    fetchMock.mockResolvedValueOnce(json({ id: ID }));
    await expect(getOrgChartShare(ID)).rejects.toThrow(/unreadable/);
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
