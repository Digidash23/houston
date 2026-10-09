import { deepStrictEqual, strictEqual } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  type OptimisticWrite,
  runOptimisticWrite,
} from "../src/lib/optimistic-core.ts";

type Row = { id: string };
const KEY = ["activity", "/agents/a"] as const;
const dropM1 = {
  queryKey: KEY,
  apply: (rows: Row[] | undefined) => rows?.filter((r) => r.id !== "m1"),
};
const failure = { title: "Couldn't delete", description: "It's back." };

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function seeded(): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData<Row[]>(KEY, [{ id: "m1" }, { id: "m2" }]);
  return qc;
}

let refusals: Array<{ command: string; title: string }> = [];
afterEach(() => {
  refusals = [];
});
const optimisticWrite = <T>(opts: OptimisticWrite<T>) =>
  runOptimisticWrite(opts, (command, _err, copy) => {
    refusals.push({ command, title: copy.title });
  });

describe("optimisticWrite", () => {
  it("paints the patch before the write settles", async () => {
    const qc = seeded();
    const host = deferred();
    const done = optimisticWrite({
      qc,
      command: "delete_mission",
      patches: [dropM1],
      write: () => host.promise,
      failure,
    });
    deepStrictEqual(qc.getQueryData(KEY), [{ id: "m2" }]);
    host.resolve();
    await done;
    strictEqual(refusals.length, 0);
  });

  it("rolls back and shows the authored copy when the host refuses", async () => {
    const qc = seeded();
    let rolledBack = false;
    await optimisticWrite({
      qc,
      command: "delete_mission",
      patches: [dropM1],
      write: () => Promise.reject(new Error("boom")),
      failure,
      onError: () => {
        rolledBack = true;
      },
    });
    deepStrictEqual(qc.getQueryData(KEY), [{ id: "m1" }, { id: "m2" }]);
    strictEqual(rolledBack, true);
    deepStrictEqual(refusals, [
      { command: "delete_mission", title: failure.title },
    ]);
  });

  it("holds the patch over a refetch that lands mid-write", async () => {
    const qc = seeded();
    const host = deferred();
    const done = optimisticWrite({
      qc,
      command: "delete_mission",
      patches: [dropM1],
      write: () => host.promise,
      failure,
    });
    await qc.fetchQuery({
      queryKey: KEY,
      queryFn: () => [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      staleTime: 0,
    });
    deepStrictEqual(qc.getQueryData(KEY), [{ id: "m2" }, { id: "m3" }]);
    host.resolve();
    await done;
    await qc.fetchQuery({
      queryKey: KEY,
      queryFn: () => [{ id: "m1" }],
      staleTime: 0,
    });
    deepStrictEqual(qc.getQueryData(KEY), [{ id: "m1" }]);
  });
});
