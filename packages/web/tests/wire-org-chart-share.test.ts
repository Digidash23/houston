import { HoustonClient } from "@houston/engine-adapter/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
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
 * stamps must be absent here.
 */

const BASE = "http://host";
const ID = "AbCdEfGhIjKlMnOpQrSt_-";
const PUBLISHED = {
  id: ID,
  imageUrl: `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/image`,
  pageUrl: `https://agents.gethouston.ai/o/${ID}`,
};

const { calls, reset, restore, stubFetch } = createWireCapture();

beforeEach(() => {
  installLocalStorage();
  reset();
});

afterEach(() => {
  restore();
  vi.clearAllMocks();
});

function client(controlPlane = true) {
  const c = new HoustonClient({ baseUrl: BASE, token: "t", controlPlane });
  c.setActiveOrg(ORG);
  return c;
}

const png = () =>
  new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("publishOrgChartShare", () => {
  test("POSTs multipart {file, title}, authorized and space-scoped", async () => {
    stubFetch(() => json(201, PUBLISHED));
    const image = png();

    await expect(
      client().publishOrgChartShare({ image, title: "Acme & Co" }),
    ).resolves.toEqual({ kind: "published", ...PUBLISHED });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(`${BASE}/v1/org-chart-shares`);
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

  test("answers the gateway's 503 as unavailable, typed", async () => {
    stubFetch(() => json(503, { error: "no blob store" }));

    await expect(
      client().publishOrgChartShare({ image: png(), title: "Acme" }),
    ).resolves.toEqual({ kind: "refused", code: "unavailable" });
  });

  test("asks nothing where there is no gateway", async () => {
    stubFetch(() => json(201, PUBLISHED));

    await expect(
      client(false).publishOrgChartShare({ image: png(), title: "Acme" }),
    ).resolves.toEqual({ kind: "refused", code: "unavailable" });
    expect(calls).toEqual([]);
  });

  test("surfaces a server failure as the engine error the app catches", async () => {
    stubFetch(() => json(500, { error: "boom" }));

    await expect(
      client().publishOrgChartShare({ image: png(), title: "Acme" }),
    ).rejects.toMatchObject({ name: "HoustonEngineError", status: 500 });
  });
});
