import { describe, expect, it, vi } from "vitest";
import type { SdkConfig, SdkPorts } from "../../ports";
import { HoustonSdk } from "../../sdk";
import { memoryKv } from "../../test-ports";
import {
  ORG_CHART_SHARE_FALLBACK_TITLE,
  orgChartShareTitle,
} from "./chart-share";
import { ORG_CHART_SHARE_DEADLINE_MS } from "./chart-share-deadline";

const BASE = "http://127.0.0.1:4317";
const ID = "AbCdEfGhIjKlMnOpQrSt_-";
const PUBLISHED = {
  id: ID,
  imageUrl: `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/image`,
  pageUrl: `https://agents.gethouston.ai/o/${ID}`,
};
const PREVIEW_URL = `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/preview`;

interface Recorded {
  method: string;
  url: string;
  init: RequestInit | undefined;
}

/** A clock whose timers fire only when the test says so. */
function manualClock() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    clock: {
      now: () => 0,
      setTimeout: (fn: () => void, ms: number) => {
        timers.set(next, { fn, ms });
        return next++;
      },
      clearTimeout: (id: number) => void timers.delete(id),
    },
    pending: () => [...timers.values()].map((t) => t.ms),
    fire: () => {
      for (const [id, t] of timers) {
        timers.delete(id);
        t.fn();
      }
    },
  };
}

function makeSdk(
  respond: () => Response | Promise<Response>,
  clock: SdkPorts["clock"] = manualClock().clock,
) {
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
    clock,
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
      [410, "account_deleted", "account_deleted"],
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

  it("refuses an oversized picture without asking", async () => {
    const { sdk, calls } = makeSdk(() => json(PUBLISHED, 201));
    await expect(
      sdk.org.publishOrgChartShare({
        image: png(6 * 1024 * 1024 + 1),
        title: "Acme",
      }),
    ).resolves.toEqual({ kind: "refused", code: "too_large" });
    expect(calls).toEqual([]);
  });

  it("publishes a blank title under the fallback", async () => {
    const { sdk, calls } = makeSdk(() => json(PUBLISHED, 201));
    await sdk.org.publishOrgChartShare({ image: png(), title: "   " });
    const form = calls[0]?.init?.body as FormData;
    expect(form.get("title")).toBe(ORG_CHART_SHARE_FALLBACK_TITLE);
  });

  it("sends the link card as the optional preview part", async () => {
    const { sdk, calls } = makeSdk(() =>
      json({ ...PUBLISHED, previewUrl: PREVIEW_URL }, 201),
    );
    const preview = png(5);
    const result = await sdk.org.publishOrgChartShare({
      image: png(),
      preview,
      title: "Acme",
    });
    expect(result).toEqual({
      kind: "published",
      ...PUBLISHED,
      previewUrl: PREVIEW_URL,
    });
    const form = calls[0]?.init?.body as FormData;
    expect([...form.keys()]).toEqual(["file", "preview", "title"]);
    const part = form.get("preview") as File;
    expect(part.name).toBe("org-chart-preview.png");
    expect(part.size).toBe(preview.size);
  });

  it("refuses a link card over 2 MiB without asking", async () => {
    const { sdk, calls } = makeSdk(() => json(PUBLISHED, 201));
    await expect(
      sdk.org.publishOrgChartShare({
        image: png(),
        preview: png(2 * 1024 * 1024 + 1),
        title: "Acme",
      }),
    ).resolves.toEqual({ kind: "refused", code: "too_large" });
    expect(calls).toEqual([]);
  });

  it("sends nothing to a deployment that is not the gateway, and asks when it is unknown", async () => {
    const local = makeSdk(() => json(PUBLISHED, 201));
    await expect(
      local.sdk.org.publishOrgChartShare({
        image: png(),
        title: "Acme",
        deployment: { spaces: false },
      }),
    ).resolves.toEqual({ kind: "refused", code: "unavailable" });
    await expect(
      local.sdk.org.publishOrgChartShare({
        image: png(),
        title: "Acme",
        deployment: {},
      }),
    ).resolves.toEqual({ kind: "refused", code: "unavailable" });
    expect(local.calls).toEqual([]);

    for (const deployment of [{ spaces: true }, null, undefined]) {
      const asked = makeSdk(() => json(PUBLISHED, 201));
      await expect(
        asked.sdk.org.publishOrgChartShare({
          image: png(),
          title: "Acme",
          deployment,
        }),
      ).resolves.toMatchObject({ kind: "published" });
      expect(asked.calls).toHaveLength(1);
    }
  });

  it("rejects with the caller's reason the moment its signal aborts, and aborts the request", async () => {
    const controller = new AbortController();
    // A transport that never reads the signal: the abort must not wait on it.
    const { sdk, calls } = makeSdk(() => new Promise<Response>(() => {}));
    const publishing = sdk.org.publishOrgChartShare({
      image: png(),
      title: "Acme",
      signal: controller.signal,
    });
    await Promise.resolve();
    const sent = calls[0]?.init?.signal;
    expect(sent?.aborted).toBe(false);
    controller.abort(new DOMException("closed", "AbortError"));
    await expect(publishing).rejects.toMatchObject({ name: "AbortError" });
    expect(sent?.aborted).toBe(true);
  });

  it("rejects an already aborted publish without asking", async () => {
    const { sdk, calls } = makeSdk(() => json(PUBLISHED, 201));
    await expect(
      sdk.org.publishOrgChartShare({
        image: png(),
        title: "Acme",
        signal: AbortSignal.abort(new DOMException("closed", "AbortError")),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual([]);
  });

  it("gives up past its deadline: the request is aborted and the publish answers timed_out", async () => {
    const timers = manualClock();
    const { sdk, calls } = makeSdk(
      () => new Promise<Response>(() => {}),
      timers.clock,
    );
    const publishing = sdk.org.publishOrgChartShare({
      image: png(),
      title: "Acme",
    });
    await Promise.resolve();
    expect(timers.pending()).toEqual([ORG_CHART_SHARE_DEADLINE_MS]);
    timers.fire();
    await expect(publishing).resolves.toEqual({
      kind: "refused",
      code: "timed_out",
    });
    expect(calls[0]?.init?.signal?.aborted).toBe(true);
  });

  it("clears its deadline once the gateway answers", async () => {
    const timers = manualClock();
    const { sdk } = makeSdk(() => json(PUBLISHED, 201), timers.clock);
    await sdk.org.publishOrgChartShare({ image: png(), title: "Acme" });
    expect(timers.pending()).toEqual([]);
  });
});

describe("orgChartShareTitle", () => {
  it("cuts at 120 code points without splitting an emoji", () => {
    const long = `${"a".repeat(119)}🚀🚀`;
    expect(Array.from(orgChartShareTitle(long))).toHaveLength(120);
    expect(orgChartShareTitle(long).endsWith("🚀")).toBe(true);
  });

  it("keeps the zero-width joiner inside an emoji", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(orgChartShareTitle(`Acme ${family}`)).toBe(`Acme ${family}`);
  });

  it("drops bidi overrides, zero-width spaces and control characters", () => {
    expect(orgChartShareTitle("\u202EAc\u200Bme\u0007\u2066")).toBe("Acme");
  });

  it("falls back when nothing printable is left", () => {
    for (const blank of ["", "   ", "\u200B\u202E", "\u200D", " \u0000 "])
      expect(orgChartShareTitle(blank)).toBe(ORG_CHART_SHARE_FALLBACK_TITLE);
  });

  it("keeps a lone surrogate without throwing", () => {
    expect(() => orgChartShareTitle("Acme \uD83D")).not.toThrow();
    expect(orgChartShareTitle(`${"a".repeat(119)}\uD83D\uD83D`)).toHaveLength(
      120,
    );
  });
});
