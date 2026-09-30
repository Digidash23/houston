import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import type { ObjectMetadata } from "./object-manifest";
import { type ObjectStore, StoreConflictError } from "./object-store";
import { syncBack } from "./sync-back";

/**
 * The standing store sync (a pod's daemon, no `workerMerge`) on the run
 * history: a generation conflict merges the runs once, like routines, so a
 * run a sandbox landed while the pod was awake is never overwritten.
 */

const RUNS = "workspaces/P/Bob/.houston/routine_runs/routine_runs.json";
const run = (id: string, minute: number) => ({
  id,
  routine_id: "r1",
  status: "surfaced",
  started_at: `2026-09-30T10:0${minute}:00.000Z`,
  completed_at: `2026-09-30T10:0${minute}:30.000Z`,
});

async function standing(opts: {
  local: string;
  remote: string;
  /** The host's own write landing while the daemon reads the remote. */
  duringRead?: string;
}) {
  const root = await mkdtemp(join(tmpdir(), "standing-runs-"));
  const abs = join(root, ...RUNS.split("/"));
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, opts.local);
  const preconditions: Array<string | undefined> = [];
  let uploaded: string | undefined;
  const store: ObjectStore = {
    list: async () => [RUNS],
    manifest: async (): Promise<ObjectMetadata[]> => [
      { key: RUNS, size: 1, md5: "", updated: "", generation: "7" },
    ],
    download: async (_key, dest) => {
      await writeFile(dest, opts.remote);
      if (opts.duringRead !== undefined) await writeFile(abs, opts.duringRead);
    },
    upload: async (source, key, options) => {
      preconditions.push(options?.ifGenerationMatch);
      if (preconditions.length === 1) throw new StoreConflictError(key, "412");
      uploaded = await readFile(source, "utf8");
      return { generation: "8" };
    },
    delete: async () => undefined,
  };
  const previous = { hash: "before", generation: "6" };
  const result = await syncBack(store, "", root, new Map([[RUNS, previous]]), {
    generations: true,
  });
  return {
    result,
    previous,
    preconditions,
    uploaded: () => uploaded,
    local: () => readFile(abs, "utf8"),
  };
}

test("a runs conflict on a standing pod keeps the run a sandbox landed", async () => {
  const sync = await standing({
    local: JSON.stringify([run("pod", 2)]),
    remote: JSON.stringify([run("sandbox", 1)]),
  });

  expect(sync.preconditions).toEqual(["6", "7"]);
  const landed = JSON.parse(sync.uploaded() ?? "[]") as { id: string }[];
  expect(landed.map(({ id }) => id)).toEqual(["pod", "sandbox"]);
  expect(await sync.local()).toBe(sync.uploaded());
  expect(sync.result.conflicts).toEqual([]);
});

test("a host write landing mid-merge is kept for the next pass, never clobbered", async () => {
  const hostWrite = JSON.stringify([run("fired", 3), run("pod", 2)]);
  const sync = await standing({
    local: JSON.stringify([run("pod", 2)]),
    remote: JSON.stringify([run("sandbox", 1)]),
    duringRead: hostWrite,
  });

  expect(await sync.local()).toBe(hostWrite);
  expect(sync.preconditions).toEqual(["6"]);
  expect(sync.result.uploaded).toEqual([]);
  expect(sync.result.conflicts).toEqual([
    { key: RUNS, reason: `${RUNS} changed locally during its merge` },
  ]);
  // The stale generation stays: the next pass conflicts and merges again.
  expect(sync.result.manifest.get(RUNS)).toEqual(sync.previous);
});
