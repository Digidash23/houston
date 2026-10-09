import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  missionEditPatches,
  missionRemovalPatches,
} from "../src/lib/mission-cache-patches.ts";
import { runOptimisticWrite } from "../src/lib/optimistic-core.ts";
import { queryKeys } from "../src/lib/query-keys.ts";

const ALICE = "/agents/alice";
const BOB = "/agents/bob";
const T = "2026-10-08T12:00:00.000Z";

const activity = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  description: "",
  status: "needs_you",
  ...extra,
});
const row = (id: string, agent_path: string) => ({
  id,
  agent_path,
  title: `Task ${id}`,
  status: "needs_you",
  type: "activity",
});

/** Every cache that paints a card: the agent's list and two roster variants
 *  of the aggregate (a drifted roster leaves its rows under a key of its own). */
function seeded(): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData(queryKeys.activity(ALICE), [activity("a1"), activity("a2")]);
  qc.setQueryData(queryKeys.activity(BOB), [activity("b1")]);
  const rows = [row("a1", ALICE), row("a2", ALICE), row("b1", BOB)];
  qc.setQueryData(queryKeys.allConversations([ALICE, BOB]), rows);
  qc.setQueryData(queryKeys.allConversations([ALICE]), rows.slice(0, 2));
  return qc;
}

function paint(
  qc: QueryClient,
  patches: ReturnType<typeof missionEditPatches>,
) {
  for (const patch of patches)
    qc.setQueriesData({ queryKey: patch.queryKey }, patch.apply);
}

const ids = (data: unknown) => (data as { id: string }[]).map((r) => r.id);

describe("missionRemovalPatches", () => {
  it("takes the cards off the agent's list and every aggregate variant", () => {
    const qc = seeded();
    paint(qc, missionRemovalPatches({ [ALICE]: ["a1"], [BOB]: ["b1"] }));
    deepStrictEqual(ids(qc.getQueryData(queryKeys.activity(ALICE))), ["a2"]);
    deepStrictEqual(ids(qc.getQueryData(queryKeys.activity(BOB))), []);
    deepStrictEqual(
      ids(qc.getQueryData(queryKeys.allConversations([ALICE, BOB]))),
      ["a2"],
    );
    deepStrictEqual(ids(qc.getQueryData(queryKeys.allConversations([ALICE]))), [
      "a2",
    ]);
  });

  it("matches an aggregate row by its owning agent, never by id alone", () => {
    const [, aggregate] = missionRemovalPatches({ [BOB]: ["a1"] });
    const rows = [row("a1", ALICE)];
    strictEqual(aggregate.apply(rows), rows);
  });

  it("is idempotent, tolerates an unloaded cache, and keeps an untouched list", () => {
    const [own] = missionRemovalPatches({ [ALICE]: ["a1"] });
    const list = [activity("a1"), activity("a2")];
    const once = own.apply(list);
    deepStrictEqual(own.apply(once), once);
    strictEqual(own.apply(undefined), undefined);
    const other = [activity("a2")];
    strictEqual(own.apply(other), other);
  });
});

describe("missionEditPatches", () => {
  it("moves the cards on every board and stamps the write's time", () => {
    const qc = seeded();
    paint(qc, missionEditPatches({ [ALICE]: ["a1"] }, { status: "done" }, T));
    const own = qc.getQueryData<{ id: string; status: string }[]>(
      queryKeys.activity(ALICE),
    );
    deepStrictEqual(
      own?.map((r) => [r.id, r.status]),
      [
        ["a1", "done"],
        ["a2", "needs_you"],
      ],
    );
    const aggregate = qc.getQueryData<
      { id: string; status: string; updated_at?: string }[]
    >(queryKeys.allConversations([ALICE, BOB]));
    deepStrictEqual(aggregate?.[0], {
      ...row("a1", ALICE),
      status: "done",
      updated_at: T,
    });
    strictEqual(aggregate?.[2]?.status, "needs_you");
  });

  it("renames without touching the status", () => {
    const [own, aggregate] = missionEditPatches(
      { [ALICE]: ["a1"] },
      { title: "Renamed", status: undefined },
      T,
    );
    const list = own.apply([activity("a1")]) as {
      title: string;
      status: string;
    }[];
    deepStrictEqual([list[0].title, list[0].status], ["Renamed", "needs_you"]);
    const rows = aggregate.apply([row("a1", ALICE)]) as { status: string }[];
    strictEqual(rows[0].status, "needs_you");
  });

  it("clears a blocking interaction on a move to done, as the host does", () => {
    const [own] = missionEditPatches(
      { [ALICE]: ["a1"] },
      { status: "done" },
      T,
    );
    const blocked = activity("a1", {
      pending_interaction: {
        steps: [{ kind: "question", id: "q1", question: "Which deck?" }],
      },
    });
    const [after] = own.apply([blocked]) as Record<string, unknown>[];
    strictEqual(after.status, "done");
    strictEqual("pending_interaction" in after, false);
  });

  it("is idempotent and returns an untouched list as is", () => {
    const [own, aggregate] = missionEditPatches(
      { [ALICE]: ["a1"] },
      { status: "archived" },
      T,
    );
    const once = own.apply([activity("a1")]);
    deepStrictEqual(own.apply(once), once);
    const rows = [row("b1", BOB)];
    strictEqual(aggregate.apply(rows), rows);
    strictEqual(aggregate.apply(undefined), undefined);
  });
});

describe("a mission delete through the optimistic write", () => {
  it("rolls every board back when the host refuses", async () => {
    const qc = seeded();
    const before = qc.getQueryData(queryKeys.allConversations([ALICE, BOB]));
    const refused: string[] = [];
    await runOptimisticWrite(
      {
        qc,
        command: "delete_mission",
        patches: missionRemovalPatches({ [ALICE]: ["a1"] }),
        write: () => Promise.reject(new Error("pod asleep")),
        failure: { title: "t", description: "d" },
      },
      (command) => refused.push(command),
    );
    deepStrictEqual(
      qc.getQueryData(queryKeys.allConversations([ALICE, BOB])),
      before,
    );
    deepStrictEqual(ids(qc.getQueryData(queryKeys.activity(ALICE))), [
      "a1",
      "a2",
    ]);
    deepStrictEqual(refused, ["delete_mission"]);
  });
});
