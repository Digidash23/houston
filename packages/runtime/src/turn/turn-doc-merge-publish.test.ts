import { mergeRoutineRunArrays } from "@houston/runtime-client/object-sync";
import { expect, test } from "vitest";
import { DOC_MERGE_ROUNDS, publishMerged } from "./turn-doc-merge-publish";
import { docStore, type Row, row } from "./turn-doc-store.test-support";

const options = (fetchImpl: typeof fetch) => ({
  family: "routine_runs",
  baseUrl: "https://store.example",
  org: "acme",
  agent: "helper",
  conversationId: "routine-r1",
  hostToken: "host-token",
  claim: { token: "t", bootId: "b" },
  fetchImpl,
  retryDelaysMs: [],
});

const mergeInto = (rows: Row[]) => (current: unknown) =>
  mergeRoutineRunArrays(Array.isArray(current) ? current : [], rows);

test("eight runs publishing at once all land their row", async () => {
  const store = docStore([row("run-0", 0)]);
  const runs = Array.from({ length: 8 }, (_, i) => row(`run-${i + 1}`, i + 1));

  const results = await Promise.all(
    runs.map((mine) =>
      publishMerged(options(store.fetchImpl), mergeInto([mine]), () => 0),
    ),
  );

  expect(results).toEqual(runs.map(() => ({ ok: true })));
  expect(store.doc().map((r) => r.id)).toEqual([
    ...runs.map((r) => r.id).reverse(),
    "run-0",
  ]);
});

test("a doc still contended after every round is reported, not claimed", async () => {
  const store = docStore([row("run-0", 0)]);
  let rounds = 0;
  const contended = (async (url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      rounds += 1;
      store.raceNextPut([row(`other-${rounds}`, rounds), row("run-0", 0)]);
    }
    return store.fetchImpl(String(url), init);
  }) as typeof fetch;

  const result = await publishMerged(
    options(contended),
    mergeInto([row("mine", 9)]),
    () => 0,
  );

  expect(result).toEqual({ error: "PUT rejected (409)" });
  expect(rounds).toBe(DOC_MERGE_ROUNDS);
});
