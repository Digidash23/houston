import type { BillingChoice } from "@houston/wire-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeHost, startFakeHost } from "./server";

const org = (slug: string, name: string) => ({
  slug,
  name,
  personal: false,
  memberCount: 1,
  messages30d: 0,
  lastActiveOn: null,
  monthlyTotalCents: null,
  seatGraceEndsOn: null,
  lockAt: null,
});

const CHOICE: BillingChoice = {
  needed: true,
  payer: null,
  state: "pending",
  provisional: false,
  cutoverAt: "2026-10-23T05:00:00Z",
  changeableUntil: null,
  noticeDismissed: false,
  freeOrgSlug: null,
  paidOrgSlug: null,
  orgs: [org("1111111111111111", "La Fila"), org("2222222222222222", "Innova")],
};

describe("billing choice", () => {
  let host: FakeHost;
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${host.url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeEach(async () => {
    host = await startFakeHost(0);
    await send("POST", "/__test__/reset");
  });
  afterEach(async () => {
    await host.stop();
  });

  it("answers 404 until armed, like a gateway that predates it", async () => {
    expect((await send("GET", "/v1/me/billing-choice")).status).toBe(404);
  });

  it("stores a pick, refuses foreign and payer-only picks, and dismisses", async () => {
    await send("POST", "/__test__/billing-choice", { choice: CHOICE });
    expect(await (await send("GET", "/v1/me/billing-choice")).json()).toEqual(
      CHOICE,
    );

    const foreign = await send("PUT", "/v1/me/billing-choice", {
      freeOrgSlug: "ffffffffffffffff",
    });
    expect(foreign.status).toBe(409);
    expect(await foreign.json()).toMatchObject({ code: "not_owner" });

    const notPayer = await send("PUT", "/v1/me/billing-choice", {
      freeOrgSlug: "1111111111111111",
      paidOrgSlug: "2222222222222222",
    });
    expect(notPayer.status).toBe(409);
    expect(await notPayer.json()).toMatchObject({ code: "not_payer" });

    const saved = await send("PUT", "/v1/me/billing-choice", {
      freeOrgSlug: "2222222222222222",
    });
    expect(await saved.json()).toMatchObject({
      freeOrgSlug: "2222222222222222",
      paidOrgSlug: null,
    });

    expect((await send("POST", "/v1/me/billing-choice/dismiss")).status).toBe(
      204,
    );
    expect(
      await (await send("GET", "/v1/me/billing-choice")).json(),
    ).toMatchObject({ noticeDismissed: true, freeOrgSlug: "2222222222222222" });
    const calls = await (
      await send("GET", "/__test__/billing-choice-calls")
    ).json();
    expect(calls.calls.map((c: { route: string }) => c.route)).toEqual([
      "get",
      "set",
      "set",
      "set",
      "dismiss",
      "get",
    ]);
  });

  it("refuses the same org for both picks with 400 same_org", async () => {
    await send("POST", "/__test__/billing-choice", {
      choice: { ...CHOICE, payer: "plus" },
    });
    const res = await send("PUT", "/v1/me/billing-choice", {
      freeOrgSlug: "1111111111111111",
      paidOrgSlug: "1111111111111111",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "same_org" });
  });
});
