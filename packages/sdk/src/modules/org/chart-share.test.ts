import { describe, expect, it, vi } from "vitest";
import type { SdkConfig, SdkPorts } from "../../ports";
import { HoustonSdk } from "../../sdk";
import { memoryKv } from "../../test-ports";
import { orgChartShareTitle } from "./chart-share";

const BASE = "http://127.0.0.1:4317";
const ID = "AbCdEfGhIjKlMnOpQrSt_-";
const PUBLISHED = {
  id: ID,
  imageUrl: `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/image`,
  pageUrl: `https://agents.gethouston.ai/o/${ID}`,
};

interface Recorded {
  method: string;
  url: string;
  init: RequestInit | undefined;
}

function makeSdk(respond: () => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const ports: SdkPorts = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: (init?.method ?? "GET").toUpperCase(),
        url: String(input),
        init,
      });
      return respond();
    }) as typeof fetch,
    storage: memoryKv(new Map()),
    devicePreferences: memoryKv(),
    clock: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const config: SdkConfig = { baseUrl: BASE, ports, reactivity: false };
  const sdk = new HoustonSdk(config);
  return { sdk, calls };
}

const json = (body: unknown, status = 200, headers = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const png = (bytes = 3) =>
  new Blob([new Uint8Array(bytes)], { type: "image/png" });

describe("publishOrgChartShare", () => {
  it("POSTs the picture and the title as multipart, with no JSON content type", async () => {
    const { sdk, calls } = makeSdk(() => json(PUBLISHED, 201));
    const image = png();

    await expect(
      sdk.org.publishOrgChartShare({ image, title: "  Acme  " }),
    ).resolves.toEqual({ kind: "published", ...PUBLISHED });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${BASE}/v1/org-chart-shares`);
    expect(new Headers(call.init?.headers).has("Content-Type")).toBe(false);
    const form = call.init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([...form.keys()]).toEqual(["file", "title"]);
    expect(form.get("title")).toBe("Acme");
    const file = form.get("file") as File;
    expect(file.name).toBe("org-chart.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(image.size);
  });

  it("answers each refusal typed, never a throw", async () => {
    for (const [status, error, code] of [
      [400, "invalid_title", "invalid_title"],
      [400, "invalid_image", "not_an_image"],
      [401, "unauthorized", "signed_out"],
      [404, "not_found", "unavailable"],
      [413, "image_too_large", "too_large"],
      [415, "unsupported_media_type", "not_an_image"],
      [503, "not_configured", "unavailable"],
    ] as const) {
      const { sdk } = makeSdk(() => json({ error }, status));
      await expect(
        sdk.org.publishOrgChartShare({ image: png(), title: "Acme" }),
      ).resolves.toEqual({ kind: "refused", code });
    }
  });

  it("carries a 429's Retry-After", async () => {
    const { sdk } = makeSdk(() =>
      json({ error: "rate limited" }, 429, { "Retry-After": "30" }),
    );
    await expect(
      sdk.org.publishOrgChartShare({ image: png(), title: "Acme" }),
    ).resolves.toEqual({
      kind: "refused",
      code: "rate_limited",
      retryAfterMs: 30_000,
    });
  });

  it("reads a fetch with no answer as offline", async () => {
    const { sdk } = makeSdk(() => Promise.reject(new TypeError("Load failed")));
    await expect(
      sdk.org.publishOrgChartShare({ image: png(), title: "Acme" }),
    ).resolves.toEqual({ kind: "refused", code: "offline" });
  });

  it("throws a server failure and an unreadable 201", async () => {
    const failing = makeSdk(() => json({ error: "boom" }, 500)).sdk;
    await expect(
      failing.org.publishOrgChartShare({ image: png(), title: "Acme" }),
    ).rejects.toMatchObject({ status: 500 });
    const garbled = makeSdk(() => json({ id: "x" }, 201)).sdk;
    await expect(
      garbled.org.publishOrgChartShare({ image: png(), title: "Acme" }),
    ).rejects.toThrow(/unreadable/);
  });

  it("refuses an empty title and an oversized picture without asking", async () => {
    const { sdk, calls } = makeSdk(() => json(PUBLISHED, 201));
    await expect(
      sdk.org.publishOrgChartShare({ image: png(), title: "   " }),
    ).resolves.toEqual({ kind: "refused", code: "invalid_title" });
    await expect(
      sdk.org.publishOrgChartShare({
        image: png(6 * 1024 * 1024 + 1),
        title: "Acme",
      }),
    ).resolves.toEqual({ kind: "refused", code: "too_large" });
    expect(calls).toEqual([]);
  });
});

describe("orgChartShareTitle", () => {
  it("cuts at 120 code points without splitting an emoji", () => {
    const long = `${"a".repeat(119)}🚀🚀`;
    expect(Array.from(orgChartShareTitle(long))).toHaveLength(120);
    expect(orgChartShareTitle(long).endsWith("🚀")).toBe(true);
  });
});
