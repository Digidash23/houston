import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { config } from "../config";
import { titleMissionAfterTurn } from "./mission-title-report";

const REQ = {
  fallback: "Write the weekly...",
  text: "Write the weekly sales report",
};
const MODEL = { provider: "openai-codex", id: "gpt-5.5" };
const prev = { url: "", token: "" };

beforeEach(() => {
  prev.url = config.controlPlaneUrl;
  prev.token = config.sandboxToken;
  config.controlPlaneUrl = "http://host.test";
  config.sandboxToken = "sbx-token";
});

afterEach(() => {
  config.controlPlaneUrl = prev.url;
  config.sandboxToken = prev.token;
  vi.restoreAllMocks();
});

test("posts the generated title with the fallback it may replace", async () => {
  const fetchImpl = vi.fn(async () => new Response("{}"));
  await titleMissionAfterTurn("activity-m1", REQ, MODEL, undefined, {
    run: async () => "Weekly sales summary",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  expect(fetchImpl).toHaveBeenCalledOnce();
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("http://host.test/sandbox/missions/title");
  expect(JSON.parse(String(init.body))).toEqual({
    conversation_id: "activity-m1",
    title: "Weekly sales summary",
    fallback: REQ.fallback,
  });
});

test("a failed title writes nothing and does not throw", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fetchImpl = vi.fn(async () => new Response("{}"));
  await titleMissionAfterTurn("activity-m1", REQ, MODEL, undefined, {
    run: async () => {
      throw new Error("provider down");
    },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("a host refusal is reported, not dropped", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
  await titleMissionAfterTurn("activity-m1", REQ, MODEL, undefined, {
    run: async () => "Weekly sales summary",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    retryDelaysMs: [],
  });
  expect(error).toHaveBeenCalledOnce();
  expect(String(error.mock.calls[0]?.[0])).toContain("HTTP 400");
});

test("an unreachable host is a warning, not a Sentry error", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
  await titleMissionAfterTurn("activity-m1", REQ, MODEL, undefined, {
    run: async () => "Weekly sales summary",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    retryDelaysMs: [],
  });
  expect(error).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledOnce();
});

test("a 200 {ok:false} (card renamed meanwhile) stays quiet", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const fetchImpl = vi.fn(async () => Response.json({ ok: false }));
  await titleMissionAfterTurn("activity-m1", REQ, MODEL, undefined, {
    run: async () => "Weekly sales summary",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  expect(error).not.toHaveBeenCalled();
});
