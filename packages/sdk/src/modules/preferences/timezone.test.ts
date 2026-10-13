import { describe, expect, it, vi } from "vitest";
import type { SdkConfig, SdkPorts } from "../../ports";
import { HoustonSdk } from "../../sdk";
import { memoryKv } from "../../test-ports";

const BASE = "http://127.0.0.1:4318";

interface Recorded {
  method: string;
  url: string;
  body: string | null;
}

function makeSdk(answer: () => Response) {
  const calls: Recorded[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: typeof init?.body === "string" ? init.body : null,
      });
      return answer();
    },
  );
  const ports: SdkPorts = {
    fetch: fetchImpl as unknown as typeof fetch,
    storage: memoryKv(new Map()),
    devicePreferences: memoryKv(),
    clock: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const config: SdkConfig = { baseUrl: BASE, ports, reactivity: false };
  return { sdk: new HoustonSdk(config), calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("seeding the timezone", () => {
  it("is ONE create-only PUT of the detected zone", async () => {
    const { sdk, calls } = makeSdk(() => json({ value: "America/Bogota" }));
    expect(
      await sdk.preferences.seedTimezone({ detected: "America/Bogota" }),
    ).toEqual({
      kind: "seeded",
      timezone: "America/Bogota",
      source: "detected",
    });
    expect(calls).toEqual([
      {
        method: "PUT",
        url: `${BASE}/v1/preferences/timezone`,
        body: JSON.stringify({ value: "America/Bogota", onlyIfAbsent: true }),
      },
    ]);
  });

  it("a stored zone wins: the 412 answer is read, nothing thrown", async () => {
    const { sdk } = makeSdk(() =>
      json({ code: "preference_exists", value: "Europe/Lisbon" }, 412),
    );
    expect(
      await sdk.preferences.seedTimezone({ detected: "America/Bogota" }),
    ).toEqual({ kind: "stored", timezone: "Europe/Lisbon" });
  });

  it("lifts this device's old zone before the detected one", async () => {
    const { sdk, calls } = makeSdk(() => json({ value: "Asia/Tokyo" }));
    expect(
      await sdk.preferences.seedTimezone({
        detected: "America/Bogota",
        legacy: "Asia/Tokyo",
      }),
    ).toEqual({ kind: "seeded", timezone: "Asia/Tokyo", source: "legacy" });
    expect(calls[0]?.body).toBe(
      JSON.stringify({ value: "Asia/Tokyo", onlyIfAbsent: true }),
    );
  });

  it("any other failure still throws", async () => {
    const { sdk } = makeSdk(() => json({ error: "boom" }, 500));
    await expect(
      sdk.preferences.seedTimezone({ detected: "America/Bogota" }),
    ).rejects.toThrow();
  });
});
