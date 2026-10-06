import { expect, test } from "vitest";
import {
  agentStore,
  applyRoute,
  claimedTurn,
  podDocs,
  routine,
  storedRoutines,
} from "./turn-views.test-support";

/**
 * The plan floor on a sleeping agent's routine writes, run on a pool worker:
 * a turn's own `save_routine` (TurnRequest.limits) and the person's edit that
 * the gateway routes as an op (the op envelope's `limits`). Both reach the
 * host's one routine-write gate, so both answer `400 plan_min_interval` and
 * leave a disabled routine alone.
 */

const LIMITS = { routineMinIntervalMinutes: 15 };

test("a pooled turn's update is held to the floor unless it leaves the routine disabled", async () => {
  const agent = await agentStore([routine("r1", "Morning brief")]);
  const turn = await claimedTurn(agent, podDocs(), "c1", { limits: LIMITS });
  const save = (body: Record<string, unknown>) =>
    turn.writeRoute("/sandbox/routines/save", body);

  const tightened = await save({ id: "r1", schedule: "*/5 * * * *" });
  expect(tightened?.status).toBe(400);
  expect(await tightened?.json()).toMatchObject({
    code: "plan_min_interval",
    minIntervalMinutes: 15,
  });
  // A routine left disabled never fires: disabling a fast schedule passes.
  const disabled = await save({
    id: "r1",
    enabled: false,
    schedule: "*/5 * * * *",
  });
  expect(disabled?.status).toBe(200);
  // Re-enabling it is judged, and says the schedule has to move first.
  const resumed = await save({ id: "r1", enabled: true });
  expect(resumed?.status).toBe(400);
  expect(await resumed?.json()).toMatchObject({
    error: expect.stringContaining("already runs more often"),
  });
});

test("an op's routine edit is held to the floor the envelope carries", async () => {
  const agent = await agentStore([routine("r1", "Morning brief")]);
  const patch = { method: "PATCH", rest: "routines/r1" };
  const refused = await applyRoute(
    agent,
    { ...patch, body: { schedule: "*/5 * * * *" } },
    { limits: LIMITS },
  );
  expect(refused.status).toBe(400);
  expect(JSON.parse(refused.body)).toMatchObject({
    code: "plan_min_interval",
    minIntervalMinutes: 15,
  });
  const created = await applyRoute(
    agent,
    {
      method: "POST",
      rest: "routines",
      body: { name: "Inbox", prompt: "Check it", schedule: "*/5 * * * *" },
    },
    { limits: LIMITS },
  );
  expect(created.status).toBe(400);
  // No stamp, no floor: the same edit saves.
  const saved = await applyRoute(agent, {
    ...patch,
    body: { schedule: "*/5 * * * *" },
  });
  expect(saved.status).toBe(200);
});

test("an op's raw routines-document write is judged routine by routine", async () => {
  const agent = await agentStore([routine("r1", "Morning brief")]);
  const stored = await storedRoutines(agent);
  const write = (items: unknown[]) =>
    applyRoute(
      agent,
      {
        method: "PUT",
        rest: "agentfile/.houston/routines/routines.json",
        body: { content: JSON.stringify(items) },
      },
      { limits: LIMITS },
    );
  const fast = { ...routine("r2", "Inbox"), schedule: "*/5 * * * *" };
  expect((await write([...stored, fast])).status).toBe(400);
  expect((await write([...stored, { ...fast, enabled: false }])).status).toBe(
    200,
  );
});
