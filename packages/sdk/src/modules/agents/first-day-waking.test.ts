import { describe, expect, it, vi } from "vitest";
import type { SdkPorts } from "../../ports";
import { HoustonSdk } from "../../sdk";
import { memoryKv } from "../../test-ports";
import { WAKING_CREATE_RETRY_MS } from "../activities/busy-retry";
import { AgentsCommand } from "./index";

/**
 * A first day is offered the moment a new hire is created, usually seconds
 * before its pod answers. The start therefore rides out the gateway's waking
 * answers on the board-card create's ladder, in the SDK, so every surface and
 * the AI Manager get the same wait. The host makes the start idempotent, which
 * is what makes a re-issue safe.
 */

const BASE = "http://127.0.0.1:4317";
const WAKING = JSON.stringify({ error: "engine unavailable" });
const STARTED = {
  outcome: "started",
  mission: { id: "m1", sessionKey: "activity-m1", title: "Getting set up" },
  role: "Financial analyst",
  arrival: "created",
};

type Answer = () => Response;

const refusal =
  (status: number, body: string): Answer =>
  () =>
    new Response(body, { status });

const started: Answer = () =>
  new Response(JSON.stringify(STARTED), {
    status: 201,
    headers: { "content-type": "application/json" },
  });

/**
 * An SDK whose `fetch` plays `answers` in order (the last repeats) and whose
 * clock fires every timer at once, recording the pause asked for, so a whole
 * ladder runs without waiting.
 */
function makeSdk(answers: Answer[]) {
  const pauses: number[] = [];
  const bodies: unknown[] = [];
  const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const answer = answers[Math.min(bodies.length, answers.length - 1)];
    bodies.push(init?.body === undefined ? undefined : String(init.body));
    return answer();
  });
  const ports: SdkPorts = {
    fetch: fetchImpl as unknown as typeof fetch,
    storage: memoryKv(),
    devicePreferences: memoryKv(),
    clock: {
      now: () => 0,
      setTimeout: (fn, ms) => {
        pauses.push(ms);
        queueMicrotask(fn);
        return pauses.length;
      },
      clearTimeout: () => {},
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const sdk = new HoustonSdk({ baseUrl: BASE, ports, reactivity: false });
  return { sdk, pauses, bodies };
}

describe("startFirstDay while the new hire's pod wakes", () => {
  it("re-issues the same start after a waking answer and resolves the task", async () => {
    const { sdk, pauses, bodies } = makeSdk([refusal(503, WAKING), started]);
    const result = await sdk.agents.startFirstDay("a1", { locale: "es" });
    expect(result).toEqual(STARTED);
    expect(bodies).toEqual(['{"locale":"es"}', '{"locale":"es"}']);
    expect(pauses).toEqual([WAKING_CREATE_RETRY_MS[0]]);
    sdk.dispose();
  });

  it("walks every waking pair the gateway mints, on the create's ladder", async () => {
    const { sdk, pauses, bodies } = makeSdk([
      refusal(503, WAKING),
      refusal(502, JSON.stringify({ error: "engine proxy failed" })),
      refusal(
        503,
        JSON.stringify({
          error: "the agent's runtime is still starting, try again shortly",
        }),
      ),
      started,
    ]);
    expect(await sdk.agents.startFirstDay("a1")).toEqual(STARTED);
    expect(bodies).toHaveLength(4);
    expect(pauses).toEqual([...WAKING_CREATE_RETRY_MS]);
    sdk.dispose();
  });

  it("an exhausted ladder surfaces the last waking refusal once", async () => {
    const { sdk, pauses, bodies } = makeSdk([refusal(503, WAKING)]);
    const err = await sdk.agents.startFirstDay("a1").catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "AgentsHttpError", status: 503 });
    expect(bodies).toHaveLength(WAKING_CREATE_RETRY_MS.length + 1);
    expect(pauses).toEqual([...WAKING_CREATE_RETRY_MS]);
    sdk.dispose();
  });

  it("a 503 that is not a waking answer is a real failure, never retried", async () => {
    const { sdk, pauses, bodies } = makeSdk([
      refusal(503, JSON.stringify({ error: "quota exceeded" })),
      started,
    ]);
    const err = await sdk.agents.startFirstDay("a1").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 503 });
    expect(bodies).toHaveLength(1);
    expect(pauses).toEqual([]);
    sdk.dispose();
  });

  it("the AI Manager's command path waits the same way", async () => {
    const { sdk, bodies } = makeSdk([refusal(503, WAKING), started]);
    const out = await sdk.dispatch({
      id: "c1",
      type: AgentsCommand.StartFirstDay,
      payload: { agentId: "a1" },
    });
    expect(out).toMatchObject({ ok: true, value: STARTED });
    expect(bodies).toHaveLength(2);
    sdk.dispose();
  });
});
