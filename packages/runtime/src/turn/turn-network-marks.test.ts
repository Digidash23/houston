import { afterEach, expect, test } from "vitest";
import {
  installTurnNetworkMarks,
  markTurnOnce,
  setActiveTurnTimings,
} from "./turn-network-marks";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("marks the first provider fetch and ignores Houston's own origins", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response("ok");
  };
  installTurnNetworkMarks(["https://gateway.test"]);
  const timings: Record<string, number> = {};
  setActiveTurnTimings(timings);

  await fetch("https://gateway.test/v1/pod/store/o/a/manifest");
  expect(timings.t_provider_fetch_start).toBeUndefined();
  await fetch("https://api.provider.test/v1/messages");
  const first = timings.t_provider_fetch_start;
  await fetch("https://api.provider.test/v1/messages");

  expect(first).toBeTypeOf("number");
  expect(timings.t_provider_fetch_start).toBe(first);
  expect(timings.t_provider_fetch_headers).toBeGreaterThanOrEqual(first ?? 0);
  expect(calls).toHaveLength(3);
});

test("markTurnOnce keeps the first stamp", () => {
  const timings: Record<string, number> = {};
  setActiveTurnTimings(timings);
  markTurnOnce("t_x");
  const first = timings.t_x;
  markTurnOnce("t_x");
  expect(timings.t_x).toBe(first);
});
