import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeActivities, parseJsonDoc } from "@houston/domain";
import { expect, test } from "vitest";
import {
  type AgentStore,
  agentStore,
  claimedTurn,
  holdFirstGet,
  podDocs,
  seed,
  WORKSPACE_REL,
} from "./turn-views.test-support";

/**
 * The gateway serves a sleeping agent's board from the activity doc, and
 * every pooled turn that moved a card republishes it. A turn that publishes
 * late must never put its older board over a newer turn's.
 */

const BOARD = ".houston/activity/activity.json";

const card = (id: string, status: string, at: string) => ({
  id,
  title: `Mission ${id}`,
  status,
  updated_at: `2026-10-01T${at}:00.000Z`,
});

async function storedBoard(agent: AgentStore) {
  const rel = `${WORKSPACE_REL}/${BOARD}`;
  const raw = await readFile(join(agent.prefixRoot, ...rel.split("/")), "utf8");
  return normalizeActivities(parseJsonDoc(raw, rel), rel).items;
}

const moveCard = async (
  turn: Awaited<ReturnType<typeof claimedTurn>>,
  id: string,
  status: string,
) => {
  const path = join(turn.filesystem.workspaceDir, ...BOARD.split("/"));
  const board = JSON.parse(await readFile(path, "utf8")) as Array<
    ReturnType<typeof card>
  >;
  await seed(
    turn.filesystem.workspaceDir,
    BOARD,
    JSON.stringify(
      board.map((c) =>
        c.id === id
          ? { ...c, status, updated_at: new Date().toISOString() }
          : c,
      ),
    ),
  );
};

test("a turn that publishes its board late never rolls back a newer turn's card", async () => {
  const gate = holdFirstGet("activity", "c1");
  const agent = await agentStore();
  await seed(
    agent.prefixRoot,
    `${WORKSPACE_REL}/${BOARD}`,
    JSON.stringify([
      card("a", "running", "09:00"),
      card("b", "running", "09:00"),
    ]),
  );
  const docs = podDocs(
    { activity: await storedBoard(agent) },
    { hold: gate.hold },
  );
  const first = await claimedTurn(agent, docs, "c1");
  await moveCard(first, "a", "done");
  const firstSettled = first.settle();
  await gate.atGet;
  const second = await claimedTurn(agent, docs, "c2");
  await moveCard(second, "b", "done");
  await second.settle();
  gate.release();
  const result = await firstSettled;

  expect(docs.doc("activity")).toEqual(await storedBoard(agent));
  expect(
    (docs.doc("activity") as { status: string }[]).map((c) => c.status),
  ).toEqual(["done", "done"]);
  expect(result.changed).toContain("ActivityChanged");
});
