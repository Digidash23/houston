import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { type ObjectStore, StoreConflictError } from "./object-store";
import { syncBack } from "./sync-back";

/**
 * Routine runs of one agent overlap in separate sandboxes: each hydrates the
 * same run history, adds its own row, settles it, and syncs back. Staging lost
 * 4 of 8 rows this way: a lost generation race overwrote the winner's rows.
 */

const RUNS = "workspaces/P/Bob/.houston/routine_runs/routine_runs.json";
type Row = Record<string, unknown>;

const body = (rows: Row[]) => `${JSON.stringify(rows, null, 2)}\n`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const run = (n: number, fields: Row = {}): Row => ({
  id: `run-${n}`,
  routine_id: "r1",
  status: "surfaced",
  session_key: "routine-r1",
  started_at: `2026-09-30T10:0${n}:00.000Z`,
  completed_at: `2026-09-30T10:0${n}:30.000Z`,
  ...fields,
});

/** A generation-guarded store holding one runs object. */
function versionedStore(initial: Row[]) {
  let remote = body(initial);
  let generation = 1;
  const store: ObjectStore = {
    list: async () => [RUNS],
    manifest: async () => [
      {
        key: RUNS,
        size: remote.length,
        md5: "",
        updated: "2026-09-30T10:00:00.000Z",
        generation: String(generation),
      },
    ],
    download: async (_key, dest) => {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, remote);
    },
    downloadVersioned: async (_key, dest) => {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, remote);
      return { generation: String(generation) };
    },
    upload: async (source, key, options) => {
      if (options?.ifGenerationMatch !== String(generation))
        throw new StoreConflictError(key, `412 at ${generation}`);
      remote = await readFile(source, "utf8");
      generation += 1;
      return { generation: String(generation) };
    },
    delete: async () => undefined,
  };
  return { store, remote: () => JSON.parse(remote) as Row[] };
}

/** One sandbox: the hydrated history at generation 1 plus this run's row. */
async function sandbox(hydrated: Row[], mine: Row) {
  const root = await mkdtemp(join(tmpdir(), "runs-overlap-"));
  const abs = join(root, ...RUNS.split("/"));
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, body([mine, ...hydrated]));
  const manifest = new Map([
    [RUNS, { hash: sha(body(hydrated)), generation: "1" }],
  ]);
  return { root, manifest, local: async () => readFile(abs, "utf8") };
}

test("eight overlapping runs of one agent all keep their row", async () => {
  const earlier = [run(0)];
  const { store, remote } = versionedStore(earlier);
  const sandboxes = await Promise.all(
    Array.from({ length: 8 }, (_, i) => sandbox(earlier, run(i + 1))),
  );

  for (const tree of sandboxes) {
    const result = await syncBack(store, "", tree.root, tree.manifest, {
      generations: true,
      workerMerge: true,
      conflictBackoff: () => 0,
    });
    expect(result.conflicts).toEqual([]);
    expect(result.uploaded).toEqual([RUNS]);
  }

  expect(remote().map((row) => row.id)).toEqual([
    "run-8",
    "run-7",
    "run-6",
    "run-5",
    "run-4",
    "run-3",
    "run-2",
    "run-1",
    "run-0",
  ]);
  // The last sandbox's tree holds exactly what landed: its settle-time
  // readers (the auto-pause) see every overlapping run.
  expect(JSON.parse(await sandboxes[7].local())).toEqual(remote());
});
