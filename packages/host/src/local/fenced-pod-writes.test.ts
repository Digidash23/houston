import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Routine } from "@houston/protocol";
import {
  LocalDirStore,
  type ObjectStore,
  StoreFencedError,
  type WriteLeaseVerdict,
} from "@houston/runtime-client/object-sync";
import { afterEach, expect, test, vi } from "vitest";
import type { RuntimeSpawner } from "../launcher/process";
import { buildLocalHost, type LocalHost } from "./host";

/**
 * PRODUCT-1706 end to end, on the real host over a store that fences like the
 * pod-store: a write lease per agent, the newest boot holds it, and a write
 * from any other boot is refused with 409 (StoreFencedError).
 *
 * The incident: a pod superseded while idle answered a routine edit to 7:00
 * with 200, kept it on its own disk (and fired it there for days), and the
 * next pod hydrated the store's 11:30. The invariant under test: a write a
 * pod acknowledges is a write the agent's next pod reads.
 */

const AGENT = encodeURIComponent("Work/Sales");
const auth = {
  Authorization: "Bearer boot-secret",
  "Content-Type": "application/json",
};
const fakeSpawner: RuntimeSpawner = {
  spawn: () => ({ port: 0, kill: () => {} }),
};

/** The agent's store prefix plus its write lease. */
class LeasedStore {
  private readonly objects = new LocalDirStore(
    mkdtempSync(join(tmpdir(), "fenced-pod-store-")),
  );
  private token = 0;
  private holder = "";
  /** Whether the holder is a running engine that keeps renewing. */
  private holderRenews = false;

  /** A boot claims the lease (the newest claim wins) and gets its view. */
  boot(bootId: string): {
    store: ObjectStore;
    leaseProbe: () => Promise<WriteLeaseVerdict>;
  } {
    this.claim(bootId, true);
    const token = this.token;
    const held = () => this.token === token && this.holder === bootId;
    const fence = (key: string) => {
      if (!held()) {
        throw new StoreFencedError(
          key,
          `object store PUT ${key} failed (409): {"error":"fencing token stale"}`,
        );
      }
    };
    return {
      store: {
        list: (prefix) => this.objects.list(prefix),
        download: (key, dest) => this.objects.download(key, dest),
        upload: async (source, key, opts) => {
          fence(key);
          return this.objects.upload(source, key, opts);
        },
        delete: async (key, opts) => {
          fence(key);
          await this.objects.delete(key, opts);
        },
      },
      leaseProbe: async () =>
        held()
          ? { state: "held" }
          : {
              state: "fenced",
              holder: this.holderRenews ? "live" : "stale",
            },
    };
  }

  /** A control-plane mint no engine adopted: nobody writes under it. */
  mint(): void {
    this.claim("wake-op", false);
  }

  /** The holding engine is gone and its renewals stop. */
  holderStops(): void {
    this.holderRenews = false;
  }

  private claim(holder: string, renews: boolean): void {
    this.token += 1;
    this.holder = holder;
    this.holderRenews = renews;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

const running: LocalHost[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((host) => host.stop()));
});

/** Boot one pod of the agent: claim the lease, hydrate, listen. */
async function bootPod(
  remote: LeasedStore,
  bootId: string,
  leaseHeartbeatMs?: number,
) {
  const houstonHome = mkdtempSync(join(tmpdir(), "fenced-pod-"));
  const workspacesRoot = join(houstonHome, "workspaces");
  mkdirSync(join(workspacesRoot, "Work", "Sales"), { recursive: true });
  const port = await freePort();
  const fenceLost = vi.fn();
  const host = buildLocalHost({
    workspacesRoot,
    credentialsPath: join(houstonHome, "credentials.json"),
    port,
    token: "boot-secret",
    runtimeCommand: ["true"],
    spawner: fakeSpawner,
    storeSync: {
      ...remote.boot(bootId),
      quietMs: 20,
      intervalMs: 60_000,
      leaseHeartbeatMs,
    },
    onStoreFenceLost: fenceLost,
  });
  await host.start();
  running.push(host);
  return { host, base: `http://127.0.0.1:${port}`, fenceLost };
}

async function routines(base: string): Promise<Routine[]> {
  const res = await fetch(`${base}/agents/${AGENT}/routines`, {
    headers: auth,
  });
  return ((await res.json()) as { items: Routine[] }).items;
}

async function stop(host: LocalHost): Promise<void> {
  running.splice(running.indexOf(host), 1);
  await host.stop();
}

test("an edit on a pod superseded while idle is refused, never acknowledged and reverted", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const remote = new LeasedStore();

  // The routine as stored: 11:30.
  const seed = await bootPod(remote, "boot-seed");
  const created = await fetch(`${seed.base}/agents/${AGENT}/routines`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Daily cloud release cut",
      prompt: "cut the release",
      schedule: "30 11 * * *",
    }),
  });
  expect(created.status).toBe(201);
  const routine = (await created.json()) as Routine;
  await stop(seed.host);

  // Pod A serves the agent; then the lease moves past it to a mint with no
  // engine behind it (staging logged exactly this on 2026-10-01; in the
  // incident a boot that took the lease and went away). A has nothing to
  // upload, so its sync never meets the 409.
  const podA = await bootPod(remote, "boot-a");
  expect((await routines(podA.base))[0]?.schedule).toBe("30 11 * * *");
  remote.mint();

  // The user moves the routine to 7:00 on pod A.
  const patched = await fetch(
    `${podA.base}/agents/${AGENT}/routines/${routine.id}`,
    {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ schedule: "0 7 * * *" }),
    },
  );
  const shownOnA = (await routines(podA.base))[0]?.schedule;
  // A's stop runs its final sync, which meets the fence if A kept the edit
  // (the watcher skips the workspaces subtree, so nothing syncs earlier).
  await new Promise((resolve) => setTimeout(resolve, 200));
  await stop(podA.host);

  // The recycle: the agent's next pod hydrates what the store holds.
  const podC = await bootPod(remote, "boot-c");
  const afterRecycle = (await routines(podC.base))[0]?.schedule;

  // The invariant: an acknowledged edit survives the recycle.
  if (patched.ok) expect(afterRecycle).toBe("0 7 * * *");
  // With the fix the edit is refused before it touches A's disk: A never
  // shows (or fires) 7:00, and the pod retires instead of serving on.
  expect(patched.status).toBe(503);
  expect(await patched.json()).toMatchObject({ code: "store_fenced" });
  expect(shownOnA).toBe("30 11 * * *");
  expect(afterRecycle).toBe("30 11 * * *");
  expect(podA.fenceLost.mock.calls).toEqual([["stale"]]);

  // The retry lands on the agent's one writer and survives the next recycle.
  const retried = await fetch(
    `${podC.base}/agents/${AGENT}/routines/${routine.id}`,
    {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ schedule: "0 7 * * *" }),
    },
  );
  expect(retried.status).toBe(200);
  await stop(podC.host);
  const podD = await bootPod(remote, "boot-d");
  expect((await routines(podD.base))[0]?.schedule).toBe("0 7 * * *");
  expect(podC.fenceLost).not.toHaveBeenCalled();
}, 60_000);

// The incident's other half: the superseded pod kept firing its local copy of
// the routine for days. With no write to trip on, the heartbeat retires it.
test("an idle superseded pod retires on its own", async () => {
  const remote = new LeasedStore();
  const pod = await bootPod(remote, "boot-a", 25);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(pod.fenceLost).not.toHaveBeenCalled();

  remote.mint();
  await vi.waitFor(() => expect(pod.fenceLost.mock.calls).toEqual([["stale"]]));
}, 60_000);

// A newer engine that is running (a split brain, or this pod's replacement
// while it drains) owns the agent: the pod refuses the edit and stands down
// without claiming the lease back, and retires only once that engine stops.
test("a pod superseded by a running engine stands down, then retires when it stops", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const remote = new LeasedStore();
  const pod = await bootPod(remote, "boot-a", 25);
  remote.boot("boot-b");

  const refused = await fetch(`${pod.base}/agents/${AGENT}/routines`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "x", prompt: "x", schedule: "0 7 * * *" }),
  });
  expect(refused.status).toBe(503);
  expect(pod.fenceLost.mock.calls).toEqual([["live"]]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(pod.fenceLost.mock.calls).toEqual([["live"]]);

  remote.holderStops();
  await vi.waitFor(() =>
    expect(pod.fenceLost.mock.calls).toEqual([["live"], ["stale"]]),
  );
}, 60_000);
