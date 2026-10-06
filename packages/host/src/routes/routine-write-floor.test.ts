import { loadRoutines } from "@houston/domain";
import type { Routine } from "@houston/protocol";
import { expect, test } from "vitest";
import { MemoryVfs } from "../vfs";
import { createRoutineChecked, updateRoutineChecked } from "./routine-write";

/**
 * The plan floor on the shared routine-write gate. A turn the gateway stamped
 * with `limits.routineMinIntervalMinutes` may not save a routine that fires
 * more often; the gate judges with the app editor's own rule, so the agent and
 * the person are held to one line. No floor = no check (Plus, desktop, the
 * app's own route).
 */

const ROOT = "ws1/agent1";
const WS = "ws1";
const NOW = "2026-01-01T00:00:00.000Z";
const OPTS = { triggersEnabled: true, nowIso: NOW };
const FLOOR = { ...OPTS, minIntervalMinutes: 15 };

const REFUSAL = {
  error:
    "This person's plan runs a scheduled task at most once every 15 minutes, so nothing was saved. Ask whether every 15 minutes or slower works, then save again; upgrading the plan removes this limit.",
  code: "plan_min_interval",
  minIntervalMinutes: 15,
};

const every = (schedule: string) => ({
  name: "Check inbox",
  prompt: "Look for new mail.",
  schedule,
});

async function seed(vfs: MemoryVfs, schedule: string): Promise<Routine> {
  const created = await createRoutineChecked(
    vfs,
    ROOT,
    WS,
    every(schedule),
    OPTS,
  );
  if (!("routine" in created)) throw new Error("seed failed");
  return created.routine;
}

const onDisk = async (vfs: MemoryVfs) => (await loadRoutines(vfs, ROOT)).items;

test("a create below the floor is refused and nothing is saved", async () => {
  const vfs = new MemoryVfs();
  for (const cron of ["*/5 * * * *", "* * * * *", "0,5,10 * * * *"]) {
    const result = await createRoutineChecked(
      vfs,
      ROOT,
      WS,
      every(cron),
      FLOOR,
    );
    expect(result, cron).toEqual(REFUSAL);
  }
  expect(await onDisk(vfs)).toEqual([]);
});

test("a create at or above the floor saves", async () => {
  const vfs = new MemoryVfs();
  for (const cron of ["*/15 * * * *", "*/16 * * * *", "0 9 * * 1-5"]) {
    const result = await createRoutineChecked(
      vfs,
      ROOT,
      WS,
      every(cron),
      FLOOR,
    );
    expect("routine" in result, cron).toBe(true);
  }
  expect(await onDisk(vfs)).toHaveLength(3);
});

test("the refusal fits the 300 characters save_routine relays", () => {
  expect(JSON.stringify(REFUSAL).length).toBeLessThan(300);
});

test("no floor saves anything", async () => {
  const vfs = new MemoryVfs();
  const result = await createRoutineChecked(
    vfs,
    ROOT,
    WS,
    every("* * * * *"),
    OPTS,
  );
  expect("routine" in result).toBe(true);
});

test("an event-trigger routine has no cadence to judge", async () => {
  const vfs = new MemoryVfs();
  const result = await createRoutineChecked(
    vfs,
    ROOT,
    WS,
    {
      name: "New mail",
      prompt: "Triage it.",
      trigger: { toolkit: "gmail", trigger_slug: "X", trigger_config: {} },
    },
    FLOOR,
  );
  expect("routine" in result).toBe(true);
});

test("an update that tightens the schedule below the floor is refused", async () => {
  const vfs = new MemoryVfs();
  const routine = await seed(vfs, "0 9 * * *");
  const result = await updateRoutineChecked(
    vfs,
    ROOT,
    WS,
    routine.id,
    { schedule: "*/10 * * * *" },
    FLOOR,
  );
  expect(result).toEqual(REFUSAL);
  expect((await onDisk(vfs))[0]?.schedule).toBe("0 9 * * *");
});

test("renaming a routine that already fires below the floor is refused: the edit re-stamps its creator", async () => {
  const vfs = new MemoryVfs();
  const routine = await seed(vfs, "*/5 * * * *");
  const result = await updateRoutineChecked(
    vfs,
    ROOT,
    WS,
    routine.id,
    { name: "Renamed" },
    { ...FLOOR, actorSub: "free-person" },
  );
  expect(result).toEqual(REFUSAL);
  expect(await onDisk(vfs)).toEqual([routine]);
});

test("a bare pause is never refused, even below the floor", async () => {
  const vfs = new MemoryVfs();
  const routine = await seed(vfs, "*/5 * * * *");
  const result = await updateRoutineChecked(
    vfs,
    ROOT,
    WS,
    routine.id,
    { enabled: false },
    FLOOR,
  );
  expect("routine" in result).toBe(true);
  expect((await onDisk(vfs))[0]?.enabled).toBe(false);
});

test("a pause that also edits something else is judged", async () => {
  const vfs = new MemoryVfs();
  const routine = await seed(vfs, "*/5 * * * *");
  const result = await updateRoutineChecked(
    vfs,
    ROOT,
    WS,
    routine.id,
    { enabled: false, name: "Renamed" },
    FLOOR,
  );
  expect(result).toEqual(REFUSAL);
});

test("an update that moves the routine to the floor saves", async () => {
  const vfs = new MemoryVfs();
  const routine = await seed(vfs, "*/5 * * * *");
  const result = await updateRoutineChecked(
    vfs,
    ROOT,
    WS,
    routine.id,
    { schedule: "*/15 * * * *" },
    FLOOR,
  );
  expect("routine" in result).toBe(true);
  expect((await onDisk(vfs))[0]?.schedule).toBe("*/15 * * * *");
});

test("switching a fast routine to an event trigger saves", async () => {
  const vfs = new MemoryVfs();
  const routine = await seed(vfs, "*/5 * * * *");
  const result = await updateRoutineChecked(
    vfs,
    ROOT,
    WS,
    routine.id,
    {
      schedule: null,
      trigger: { toolkit: "gmail", trigger_slug: "X", trigger_config: {} },
    },
    FLOOR,
  );
  expect("routine" in result).toBe(true);
});
