import { HoustonClient } from "@houston/engine-adapter/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  type Call,
  createWireCapture,
  installLocalStorage,
  json,
  ORG,
} from "./support/wire-capture";

/**
 * Publishing the org chart picture rides `sdk.org.publishOrgChartShare`.
 *
 * Pinned literally: the whole URL, the method, the multipart parts, and the
 * headers the gateway routes on. A multipart body carries its own
 * Content-Type (with the boundary), so the JSON one every other gateway call
 * stamps must be absent here. The adapter asks only a deployment whose
 * capabilities say it is the gateway (`spaces`), so each spec answers that
 * probe first.
 */

const BASE = "http://host";
const SHARES = `${BASE}/v1/org-chart-shares`;
const ID = "AbCdEfGhIjKlMnOpQrSt_-";
const PUBLISHED = {
  id: ID,
  imageUrl: `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/image`,
  pageUrl: `https://agents.gethouston.ai/o/${ID}`,
};
const GATEWAY_CAPS = { profile: "cloud", spaces: true };

const { calls, reset, restore, stubRouted } = createWireCapture();

beforeEach(() => {
  installLocalStorage();
  reset();
});

afterEach(() => {
  restore();
  vi.clearAllMocks();
});

function client() {
  const c = new HoustonClient({
    baseUrl: BASE,
    token: "t",
    controlPlane: true,
  });
  c.setActiveOrg(ORG);
  return c;
}

/** Capabilities answer `caps`; the share route answers `share()`. */
function stubDeployment(caps: object, share: (call: Call) => Response) {
  stubRouted((call) =>
    call.url === `${BASE}/v1/capabilities` ? json(200, caps) : share(call),
  );
}

const shareCalls = () => calls.filter((call) => call.url === SHARES);

const png = () =>
  new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("publishOrgChartShare", () => {
  test("POSTs multipart {file, title}, authorized and space-scoped", async () => {
    stubDeployment(GATEWAY_CAPS, () => json(201, PUBLISHED));
    const image = png();

    await expect(
      client().publishOrgChartShare({ image, title: "Acme & Co" }),
    ).resolves.toEqual({ kind: "published", ...PUBLISHED });
    expect(shareCalls()).toHaveLength(1);
    const [call] = shareCalls();
    expect(call.url).toBe(SHARES);
    expect(call.method).toBe("POST");
    expect(call.body).toBeNull();
    expect(call.headers.get("Content-Type")).toBeNull();
    expect(call.headers.get("Authorization")).toBe("Bearer t");
    expect(call.headers.get("x-houston-org")).toBe(ORG);
    const form = call.form as FormData;
    expect([...form.keys()]).toEqual(["file", "title"]);
    expect(form.get("title")).toBe("Acme & Co");
    const file = form.get("file") as File;
    expect(file.name).toBe("org-chart.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
  });

  test("hands the caller's abort signal to the request", async () => {
    stubDeployment(GATEWAY_CAPS, () => json(201, PUBLISHED));
    const controller = new AbortController();

    await client().publishOrgChartShare(
      { image: png(), title: "Acme" },
      controller.signal,
    );
    expect(shareCalls()[0]?.signal).toBe(controller.signal);
  });

  test("answers the gateway's 503 as unavailable, typed", async () => {
    stubDeployment(GATEWAY_CAPS, () => json(503, { error: "no blob store" }));

    await expect(
      client().publishOrgChartShare({ image: png(), title: "Acme" }),
    ).resolves.toEqual({ kind: "refused", code: "unavailable" });
  });

  test("sends nothing to a deployment that is not the gateway", async () => {
    stubDeployment({ profile: "local" }, () => json(201, PUBLISHED));

    await expect(
      client().publishOrgChartShare({ image: png(), title: "Acme" }),
    ).resolves.toEqual({ kind: "refused", code: "unavailable" });
    expect(shareCalls()).toEqual([]);
  });

  test("asks the route when the capability probe fails, and lets its answer decide", async () => {
    stubRouted((call) =>
      call.url === `${BASE}/v1/capabilities`
        ? json(500, { error: "boom" })
        : json(201, PUBLISHED),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      client().publishOrgChartShare({ image: png(), title: "Acme" }),
    ).resolves.toEqual({ kind: "published", ...PUBLISHED });
    expect(shareCalls()).toHaveLength(1);
  });

  test("an abort ends a publish still waiting on the capability probe, and sends nothing", async () => {
    stubRouted((call) =>
      call.url === `${BASE}/v1/capabilities`
        ? new Promise<Response>(() => {})
        : json(201, PUBLISHED),
    );
    const controller = new AbortController();
    const publishing = client().publishOrgChartShare(
      { image: png(), title: "Acme" },
      controller.signal,
    );
    controller.abort(new DOMException("patience", "AbortError"));

    await expect(publishing).rejects.toMatchObject({ name: "AbortError" });
    expect(shareCalls()).toEqual([]);
  });

  test("surfaces a server failure as the engine error the app catches", async () => {
    stubDeployment(GATEWAY_CAPS, () => json(500, { error: "boom" }));

    await expect(
      client().publishOrgChartShare({ image: png(), title: "Acme" }),
    ).rejects.toMatchObject({ name: "HoustonEngineError", status: 500 });
  });
});
