import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { TurnServerDeps } from "./server-types";
import type { TurnFilesystem } from "./turn-filesystem";
import { publishTurnRunsDoc } from "./turn-runs-doc";
import type { TurnRequest } from "./types";

/**
 * Overlapping routine runs each project the run history into the pod-store
 * doc the Routines tab reads while the agent sleeps. Each publisher merges
 * its rows into the doc it read (or the one a 409 names), never overwrites it.
 */

type Row = { id: string; status: string; started_at: string } & Record<
  string,
  unknown
>;

const row = (id: string, minute: number, status = "surfaced"): Row => ({
  id,
  routine_id: "r1",
  status,
  session_key: "routine-r1",
  started_at: `2026-09-30T10:0${minute}:00.000Z`,
  ...(status === "running"
    ? {}
    : { completed_at: `2026-09-30T10:0${minute}:30.000Z` }),
});

/** The pod-store doc route: revisioned CAS, a 409 names the current doc. */
function docStore(
  initial: Row[] | undefined,
  opts: { bareConflict?: boolean } = {},
) {
  let doc = initial;
  let revision = initial ? 1 : 0;
  const puts: number[] = [];
  let beforePut: (() => void) | undefined;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      return doc === undefined
        ? Response.json({ error: "document not found" }, { status: 404 })
        : Response.json({ doc, revision });
    }
    const expected = Number(new Headers(init.headers).get("If-Match"));
    puts.push(expected);
    const race = beforePut;
    beforePut = undefined;
    race?.();
    if (expected !== revision) {
      return Response.json(
        opts.bareConflict ? { revision } : { revision, doc },
        { status: 409 },
      );
    }
    doc = (JSON.parse(String(init.body)) as { doc: Row[] }).doc;
    revision += 1;
    return Response.json({ doc, revision });
  }) as typeof fetch;
  return {
    fetchImpl,
    puts,
    doc: () => doc ?? [],
    /** Another publisher lands right before our next PUT. */
    raceNextPut: (rows: Row[]) => {
      beforePut = () => {
        doc = rows;
        revision += 1;
      };
    },
  };
}

async function publishRows(rows: Row[], fetchImpl: typeof fetch) {
  const workspaceDir = await mkdtemp(join(tmpdir(), "turn-runs-doc-"));
  const runsDir = join(workspaceDir, ".houston", "routine_runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(join(runsDir, "routine_runs.json"), JSON.stringify(rows));
  return publishTurnRunsDoc(
    {
      poolStoreUrl: "https://store.example",
      fetchImpl,
    } as unknown as TurnServerDeps,
    {
      shadow: false,
      claim: { token: "t", bootId: "b" },
      hostToken: "host-token",
      gcsPrefix: "ws/acme/helper",
      conversationId: "routine-r1",
      turnId: "run-2",
    } as unknown as TurnRequest & { turnId: string },
    { workspaceDir, workspaceRel: "acme/helper" } as unknown as TurnFilesystem,
  );
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

test("a slower run keeps the rows a newer doc already holds", async () => {
  // run-3 settled and published first; this run hydrated before it existed.
  const store = docStore([row("run-3", 3), row("run-1", 1)]);
  const result = await publishRows(
    [row("run-2", 2), row("run-1", 1)],
    store.fetchImpl,
  );
  expect(result).toEqual({ ok: true });
  expect(ids(store.doc())).toEqual(["run-3", "run-2", "run-1"]);
});

test("the doc's settled copy beats this run's stale running copy", async () => {
  const store = docStore([row("run-1", 1)]);
  await publishRows(
    [row("run-2", 2), row("run-1", 1, "running")],
    store.fetchImpl,
  );
  expect(store.doc().find((r) => r.id === "run-1")?.status).toBe("surfaced");
});

test("a lost revision race merges into the doc the 409 names", async () => {
  const store = docStore([row("run-1", 1)]);
  store.raceNextPut([row("run-3", 3), row("run-1", 1)]);
  const result = await publishRows(
    [row("run-2", 2), row("run-1", 1)],
    store.fetchImpl,
  );
  expect(result).toEqual({ ok: true });
  expect(store.puts).toEqual([1, 2]);
  expect(ids(store.doc())).toEqual(["run-3", "run-2", "run-1"]);
});

test("a 409 without the doc re-reads it before merging", async () => {
  const store = docStore([row("run-1", 1)], { bareConflict: true });
  store.raceNextPut([row("run-3", 3), row("run-1", 1)]);
  const result = await publishRows([row("run-2", 2)], store.fetchImpl);
  expect(result).toEqual({ ok: true });
  expect(ids(store.doc())).toEqual(["run-3", "run-2", "run-1"]);
});

test("the first publisher creates the doc from its own rows", async () => {
  const store = docStore(undefined);
  const result = await publishRows([row("run-2", 2)], store.fetchImpl);
  expect(result).toEqual({ ok: true });
  expect(store.puts).toEqual([0]);
  expect(ids(store.doc())).toEqual(["run-2"]);
});
