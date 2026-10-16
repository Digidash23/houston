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
 * stamps must be absent here. The surface hands in the deployment's own
 * capabilities; the SDK decides from them, so nothing here probes
 * `/v1/capabilities`.
 */

const BASE = "http://host";
const SHARES = `${BASE}/v1/org-chart-shares`;
const ID = "AbCdEfGhIjKlMnOpQrSt_-";
const PUBLISHED = {
  id: ID,
  imageUrl: `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/image`,
  pageUrl: `https://agents.gethouston.ai/o/${ID}`,
};
const GATEWAY = { spaces: true };

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

/** The share route answers `share()`; anything else is a 404. */
function stubShare(share: (call: Call) => Response | Promise<Response>) {
  stubRouted((call) =>
    call.url === SHARES ? share(call) : json(404, { error: "not_found" }),
  );
}

const png = (...bytes: number[]) =>
  new Blob([new Uint8Array([137, 80, 78, 71, ...bytes])], {
    type: "image/png",
  });

describe("publishOrgChartShare", () => {
  test("POSTs multipart {file, preview, title}, authorized and space-scoped", async () => {
    stubShare(() => json(201, PUBLISHED));

    await expect(
      client().publishOrgChartShare({
        image: png(),
        preview: png(1, 2),
        title: "Acme & Co",
        deployment: GATEWAY,
      }),
    ).resolves.toEqual({ kind: "published", ...PUBLISHED });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(SHARES);
    expect(call.method).toBe("POST");
    expect(call.body).toBeNull();
    expect(call.headers.get("Content-Type")).toBeNull();
    expect(call.headers.get("Authorization")).toBe("Bearer t");
    expect(call.headers.get("x-houston-org")).toBe(ORG);
    const form = call.form as FormData;
    expect([...form.keys()]).toEqual(["file", "preview", "title"]);
    expect(form.get("title")).toBe("Acme & Co");
    const file = form.get("file") as File;
    expect(file.name).toBe("org-chart.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
    const preview = form.get("preview") as File;
    expect(preview.name).toBe("org-chart-preview.png");
    expect(preview.type).toBe("image/png");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2]),
    );
  });

  test("reads the preview card's address off the 201", async () => {
    const previewUrl = `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/preview`;
    stubShare(() => json(201, { ...PUBLISHED, previewUrl }));

    await expect(
      client().publishOrgChartShare({
        image: png(),
        preview: png(1),
        title: "Acme",
        deployment: GATEWAY,
      }),
    ).resolves.toEqual({ kind: "published", ...PUBLISHED, previewUrl });
  });

  test("sends {file, title} alone when there is no card", async () => {
    stubShare(() => json(201, PUBLISHED));

    await client().publishOrgChartShare({
      image: png(),
      title: "Acme",
      deployment: GATEWAY,
    });
    expect([...(calls[0]?.form as FormData).keys()]).toEqual(["file", "title"]);
  });

  test("answers the gateway's 503 as unavailable, typed", async () => {
    stubShare(() => json(503, { error: "not_configured" }));

    await expect(
      client().publishOrgChartShare({
        image: png(),
        title: "Acme",
        deployment: GATEWAY,
      }),
    ).resolves.toEqual({ kind: "refused", code: "unavailable" });
  });

  test("sends nothing to a deployment that is not the gateway", async () => {
    stubShare(() => json(201, PUBLISHED));

    await expect(
      client().publishOrgChartShare({
        image: png(),
        title: "Acme",
        deployment: {},
      }),
    ).resolves.toEqual({ kind: "refused", code: "unavailable" });
    expect(calls).toEqual([]);
  });

  test("an abort ends the publish and aborts the request it sent", async () => {
    stubShare(() => new Promise<Response>(() => {}));
    const controller = new AbortController();
    const publishing = client().publishOrgChartShare({
      image: png(),
      title: "Acme",
      deployment: GATEWAY,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.signal?.aborted).toBe(false);
    controller.abort(new DOMException("closed", "AbortError"));

    await expect(publishing).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  test("surfaces a server failure as the engine error the app catches", async () => {
    stubShare(() => json(500, { error: "boom" }));

    await expect(
      client().publishOrgChartShare({
        image: png(),
        title: "Acme",
        deployment: GATEWAY,
      }),
    ).rejects.toMatchObject({ name: "HoustonEngineError", status: 500 });
  });
});
