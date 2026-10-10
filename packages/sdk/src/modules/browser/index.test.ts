import { describe, expect, it, vi } from "vitest";
import type { SdkConfig } from "../../ports";
import { HoustonSdk } from "../../sdk";
import { memoryKv } from "../../test-ports";
import { manualClock } from "./live-test-kit";

const BASE = "https://host.example";

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function sdk(respond: (url: string) => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return respond(String(input));
    },
  );
  const config: SdkConfig = {
    baseUrl: BASE,
    reactivity: false,
    ports: {
      fetch: fetchImpl as typeof fetch,
      storage: memoryKv(),
      devicePreferences: memoryKv(),
      clock: manualClock().clock,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
  };
  return { sdk: new HoustonSdk(config), calls };
}

const sse = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

describe("the browser module", () => {
  it("watch streams the agent's live view and parses every event", async () => {
    const { sdk: client, calls } = sdk(() =>
      sse({ type: "page", url: "https://a.com", title: "A", extra: 1 }),
    );
    const events: unknown[] = [];
    await client.browser.watch("c 1", "agent-1", "viewer_12345", "phone", {
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${BASE}/agents/agent-1/conversations/c%201/browser/live?viewer=viewer_12345&layout=phone`,
    });
    expect(events).toEqual([
      { type: "page", url: "https://a.com", title: "A" },
    ]);
  });

  it("watch rejects a message outside the contract", async () => {
    const { sdk: client } = sdk(() => sse({ type: "nope" }));
    await expect(
      client.browser.watch("c1", "agent-1", "viewer_12345", "desktop", {
        signal: new AbortController().signal,
        onEvent: () => {},
      }),
    ).rejects.toThrow("Invalid browser live event type");
  });

  it("input posts one batch and parses the answer", async () => {
    const { sdk: client, calls } = sdk(
      () => new Response('{"state":"done"}', { status: 200 }),
    );
    await expect(
      client.browser.input("c1", "agent-1", { finish: "done" }),
    ).resolves.toEqual({ state: "done" });
    expect(calls[0]).toEqual({
      method: "POST",
      url: `${BASE}/agents/agent-1/conversations/c1/browser/input`,
      body: '{"finish":"done"}',
    });
  });

  it("connect opens a live view under a fresh viewer id", async () => {
    const { sdk: client, calls } = sdk(() =>
      sse({ type: "status", state: "done", text: "t", expiresAt: 1 }),
    );
    const onConnection = vi.fn();
    client.browser.connect("c1", "agent-1", {
      onFrame: vi.fn(),
      onPage: vi.fn(),
      onStatus: vi.fn(),
      onConnection,
      onRefused: vi.fn(),
      onUnexpected: vi.fn(),
    });
    await vi.waitFor(() =>
      expect(onConnection).toHaveBeenLastCalledWith({
        kind: "ended",
        reason: "done",
      }),
    );
    expect(calls[0].url).toMatch(
      /\/agents\/agent-1\/conversations\/c1\/browser\/live\?viewer=[A-Za-z0-9_-]{8,64}&layout=desktop$/,
    );
  });
});
