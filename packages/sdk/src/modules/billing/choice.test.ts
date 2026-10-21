import { describe, expect, it, vi } from "vitest";
import type { SdkConfig, SdkPorts } from "../../ports";
import { HoustonSdk } from "../../sdk";
import { memoryKv } from "../../test-ports";
import { choice, INNOVA, LA_FILA } from "./choice-fixtures";
import {
  BillingCommand,
  BillingHttpError,
  billingChoiceRefusal,
} from "./index";

const BASE = "http://127.0.0.1:4317";

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
    headers: { "content-type": "application/json" },
  });

const STORED = choice({ freeOrgSlug: INNOVA.slug });

describe("reading the choice", () => {
  it("parses GET /v1/me/billing-choice", async () => {
    const { sdk, calls } = makeSdk(() => json(STORED));
    expect(await sdk.billing.getChoice()).toEqual(STORED);
    expect(calls).toEqual([
      { method: "GET", url: `${BASE}/v1/me/billing-choice`, body: null },
    ]);
  });

  it("answers null where the gateway does not serve the change", async () => {
    const { sdk } = makeSdk(() => json({ error: "not found" }, 404));
    expect(await sdk.billing.getChoice()).toBeNull();
  });

  it("refuses a malformed answer instead of rendering it", async () => {
    const { sdk } = makeSdk(() => json({ ...STORED, cutoverAt: "soon" }));
    await expect(sdk.billing.getChoice()).rejects.toThrow();
    const missing = makeSdk(() => json({ ...STORED, orgs: [{ slug: "x" }] }));
    await expect(missing.sdk.billing.getChoice()).rejects.toThrow();
  });

  it("reads a payer or state a later gateway adds without failing", async () => {
    const { sdk } = makeSdk(() =>
      json({ ...STORED, payer: "family", state: "migrating" }),
    );
    expect(await sdk.billing.getChoice()).toMatchObject({
      payer: null,
      state: "applied",
    });
  });

  it("throws every other failure with its status", async () => {
    const { sdk } = makeSdk(() => json({ error: "boom" }, 500));
    const err = await sdk.billing.getChoice().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BillingHttpError);
    expect((err as BillingHttpError).status).toBe(500);
  });
});

describe("saving the pick", () => {
  it("PUTs the pick and answers the stored choice", async () => {
    const { sdk, calls } = makeSdk(() => json(STORED));
    const pick = { freeOrgSlug: INNOVA.slug, paidOrgSlug: LA_FILA.slug };
    expect(await sdk.billing.setChoice(pick)).toEqual({
      kind: "saved",
      choice: STORED,
    });
    expect(calls).toEqual([
      {
        method: "PUT",
        url: `${BASE}/v1/me/billing-choice`,
        body: JSON.stringify(pick),
      },
    ]);
  });

  const refusals = [
    ["not_owner", 409],
    ["not_payer", 409],
    ["same_org", 400],
  ] as const;
  for (const [code, status] of refusals)
    it(`answers ${code} as an outcome, not an error`, async () => {
      const { sdk } = makeSdk(() => json({ code, error: code }, status));
      expect(await sdk.billing.setChoice({ freeOrgSlug: "x" })).toEqual({
        kind: code,
      });
    });

  it("throws a refusal code that arrives with the wrong status", async () => {
    const { sdk } = makeSdk(() => json({ code: "not_owner" }, 500));
    await expect(
      sdk.billing.setChoice({ freeOrgSlug: "x" }),
    ).rejects.toBeInstanceOf(BillingHttpError);
  });

  it("recognizes a refusal off the adapter's parsed body too", () => {
    const parsed = Object.assign(new Error("x"), {
      status: 400,
      body: { code: "same_org" },
    });
    expect(billingChoiceRefusal(parsed)).toBe("same_org");
    expect(billingChoiceRefusal("same_org")).toBeNull();
  });
});

describe("dismissing and dispatch", () => {
  it("dismisses with a bodyless POST", async () => {
    const { sdk, calls } = makeSdk(() => new Response(null, { status: 204 }));
    await sdk.billing.dismissChoiceNotice();
    expect(calls).toEqual([
      {
        method: "POST",
        url: `${BASE}/v1/me/billing-choice/dismiss`,
        body: null,
      },
    ]);
  });

  it("dispatches a pick, dropping an absent paid org", async () => {
    const { sdk, calls } = makeSdk(() => json(STORED));
    const result = await sdk.dispatch({
      id: "1",
      type: BillingCommand.SetChoice,
      payload: { freeOrgSlug: INNOVA.slug, paidOrgSlug: null },
    });
    expect(result).toMatchObject({ ok: true, value: { kind: "saved" } });
    expect(calls[0].body).toBe(JSON.stringify({ freeOrgSlug: INNOVA.slug }));
  });

  it("refuses a pick with no free org, without touching the wire", async () => {
    const { sdk, calls } = makeSdk(() => json(STORED));
    const result = await sdk.dispatch({
      id: "2",
      type: BillingCommand.SetChoice,
      payload: { paidOrgSlug: INNOVA.slug },
    });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
