import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleStoreFenceGate,
  isFencedWrite,
  resetStoreFenceReport,
  STORE_FENCED_ERROR,
} from "./store-fence-gate";

type FakeResponse = ServerResponse & {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

function fakeResponse(): FakeResponse {
  const res = {
    status: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    writeHead(status: number, headers: Record<string, string>) {
      res.status = status;
      res.headers = headers;
      res.headersSent = true;
      return res;
    },
    end(buf?: Buffer) {
      if (buf) res.body = JSON.parse(buf.toString("utf8"));
    },
  };
  return res as unknown as FakeResponse;
}

describe("isFencedWrite", () => {
  it("gates every authenticated mutation and no read", () => {
    expect(
      isFencedWrite("PATCH", "/agents/a/routines/r1", "authenticated"),
    ).toBe(true);
    expect(isFencedWrite("POST", "/agents/a/activities", "authenticated")).toBe(
      true,
    );
    expect(
      isFencedWrite("DELETE", "/agents/a/routines/r1", "authenticated"),
    ).toBe(true);
    // Agent data outside /agents/: colour, delegation, custom integrations.
    expect(isFencedWrite("PUT", "/v1/agents/a/color", "authenticated")).toBe(
      true,
    );
    expect(
      isFencedWrite(
        "POST",
        "/v1/integrations/custom/definitions",
        "authenticated",
      ),
    ).toBe(true);
    expect(isFencedWrite("GET", "/agents/a/routines", "authenticated")).toBe(
      false,
    );
    expect(isFencedWrite("HEAD", "/v1/agents/a/color", "authenticated")).toBe(
      false,
    );
  });

  it("gates the runtime's routine/learning/mission saves only", () => {
    expect(isFencedWrite("POST", "/sandbox/routines", "sandbox")).toBe(true);
    expect(isFencedWrite("PATCH", "/sandbox/routines/r1", "sandbox")).toBe(
      true,
    );
    expect(isFencedWrite("POST", "/sandbox/learnings", "sandbox")).toBe(true);
    expect(isFencedWrite("POST", "/sandbox/missions/start", "sandbox")).toBe(
      true,
    );
    // The credential serve and the integration proxy never touch the tree.
    expect(isFencedWrite("POST", "/sandbox/credential", "sandbox")).toBe(false);
    expect(
      isFencedWrite("POST", "/sandbox/integrations/execute", "sandbox"),
    ).toBe(false);
    // The user-facing routes are not this scope's job (gated post-auth).
    expect(isFencedWrite("PATCH", "/agents/a/routines/r1", "sandbox")).toBe(
      false,
    );
  });
});

describe("handleStoreFenceGate", () => {
  afterEach(() => {
    resetStoreFenceReport();
    vi.restoreAllMocks();
  });

  it("passes every request through while the fence is held or absent", async () => {
    const res = fakeResponse();
    expect(
      await handleStoreFenceGate(
        {},
        "PATCH",
        "/agents/a/routines/r1",
        res,
        "authenticated",
      ),
    ).toBe(false);
    expect(
      await handleStoreFenceGate(
        { storeFenced: () => false, storeWritable: async () => true },
        "PATCH",
        "/agents/a/routines/r1",
        res,
        "authenticated",
      ),
    ).toBe(false);
    expect(res.headersSent).toBe(false);
  });

  it("refuses a write with a distinct 503 once the fence is lost, and reports once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = { storeFenced: () => true };
    const first = fakeResponse();
    expect(
      await handleStoreFenceGate(
        deps,
        "PATCH",
        "/agents/a/routines/r1",
        first,
        "authenticated",
      ),
    ).toBe(true);
    expect(first.status).toBe(503);
    expect(first.body).toEqual({
      error: STORE_FENCED_ERROR,
      code: "store_fenced",
    });
    // Not the gateway's waking shape: no Retry-After, so the client surfaces
    // it as a real failure instead of a quiet wake.
    expect(first.headers["Retry-After"]).toBeUndefined();

    const second = fakeResponse();
    expect(
      await handleStoreFenceGate(
        deps,
        "POST",
        "/sandbox/routines",
        second,
        "sandbox",
      ),
    ).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toContain("write fence was lost");

    // Reads are untouched: the pod's copy is still the freshest answer.
    const read = fakeResponse();
    expect(
      await handleStoreFenceGate(
        deps,
        "GET",
        "/agents/a/routines",
        read,
        "authenticated",
      ),
    ).toBe(false);
  });

  // PRODUCT-1706: the sync had met no 409 (nothing to upload since the
  // takeover), so only the lease check knows. The write is refused before it
  // touches the disk, never acknowledged and lost at the next recycle.
  it("refuses a write the lease check says can no longer persist", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const asked: string[] = [];
    const deps = {
      storeFenced: () => false,
      storeWritable: async () => {
        asked.push("check");
        return false;
      },
    };
    const res = fakeResponse();
    expect(
      await handleStoreFenceGate(
        deps,
        "PATCH",
        "/agents/a/routines/r1",
        res,
        "authenticated",
      ),
    ).toBe(true);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: "store_fenced" });

    // A read never costs a check.
    expect(
      await handleStoreFenceGate(
        deps,
        "GET",
        "/agents/a/routines",
        fakeResponse(),
        "authenticated",
      ),
    ).toBe(false);
    expect(asked).toEqual(["check"]);
  });

  // The watcher skips the workspaces subtree and the periodic pass is five
  // minutes out: an acknowledged write ships now, under the lease the check
  // just saw, or a takeover in those minutes loses it.
  it("ships an acknowledged write to the store as soon as it is answered", async () => {
    const shipped: string[] = [];
    const deps = {
      storeFenced: () => false,
      storeWritable: async () => true,
      storeSyncAfterWrite: () => shipped.push("ship"),
    };
    const answered = (status: number) =>
      Object.assign(new EventEmitter(), {
        statusCode: status,
      }) as unknown as ServerResponse;

    const ok = answered(200);
    expect(
      await handleStoreFenceGate(
        deps,
        "PATCH",
        "/agents/a/routines/r1",
        ok,
        "authenticated",
      ),
    ).toBe(false);
    expect(shipped).toEqual([]);
    ok.emit("finish");
    expect(shipped).toEqual(["ship"]);

    // A refused or failed write changed nothing worth shipping.
    const failed = answered(400);
    await handleStoreFenceGate(
      deps,
      "POST",
      "/sandbox/routines",
      failed,
      "sandbox",
    );
    failed.emit("finish");
    // A read never ships.
    const read = answered(200);
    await handleStoreFenceGate(
      deps,
      "GET",
      "/agents/a/routines",
      read,
      "authenticated",
    );
    read.emit("finish");
    expect(shipped).toEqual(["ship"]);
  });

  it("names the state in the body so the toast and Sentry carry it", () => {
    expect(STORE_FENCED_ERROR).toContain("newer engine");
  });
});
