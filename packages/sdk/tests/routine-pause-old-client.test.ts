import {
  autoPauseRoutine,
  createRoutine,
  ROUTINE_AUTO_PAUSE_AFTER,
  routineAutoPause,
  unconnectedRoutineFailure,
} from "@houston/domain";
import type { RoutineRun } from "@houston/protocol";
import { expect, test } from "vitest";
import { routinePauseNotice } from "../src/modules/routines/auto-pause";
import * as main from "./fixtures/routine-pause-main";

// PRODUCT-1982: the gateway serves routines.json and routine_runs.json from the
// store to every client version, so what this engine writes must not throw in
// a client that predates `no_model`. The fixture is main's mapping, verbatim.

const NOW = "2026-10-06T12:00:00.000Z";
const routine = createRoutine(
  { name: "Inbox sweep", prompt: "check", schedule: "*/15 * * * *" },
  "r1",
  "2026-10-01T00:00:00.000Z",
);
const failure = unconnectedRoutineFailure(null);
const runs: RoutineRun[] = Array.from(
  { length: ROUTINE_AUTO_PAUSE_AFTER },
  (_, i) => ({
    id: `run-${i}`,
    routine_id: "r1",
    status: "error",
    session_key: "routine-r1",
    failure,
    started_at: new Date(Date.parse(NOW) - (i + 1) * 900_000).toISOString(),
  }),
);
const pause = routineAutoPause(routine, runs, NOW);
if (!pause) throw new Error("the streak should pause");
const paused = autoPauseRoutine(routine, pause);
// What a client receives: the JSON the engine wrote, read back.
const wire = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

test("an old client reads a no-model pause as 'change the model' instead of throwing", () => {
  expect(failure).toEqual({ code: "no_model" });
  const old = wire<Parameters<typeof main.routinePauseNotice>[0]>(paused);
  expect(() => main.routinePauseNotice(old)).not.toThrow();
  expect(main.routinePauseNotice(old)).toMatchObject({
    remedy: "change_model",
    failures: ROUTINE_AUTO_PAUSE_AFTER,
  });
  const reader = { provider: "", health: "ok", readerIsCreator: true };
  expect(() => main.routinePauseNotice(old, reader)).not.toThrow();
});

test("an old client reads a no-model run row without throwing", () => {
  const old = wire<Parameters<typeof main.routineFailureCode>[0]>(runs[0]);
  expect(() => main.routineFailureCode(old)).not.toThrow();
  expect(() =>
    main.routineFailureCode(old, (provider) => ({
      provider,
      readerIsCreator: true,
    })),
  ).not.toThrow();
});

test("this client reads the same pause as 'choose a model', naming no provider", () => {
  expect(routinePauseNotice(wire(paused))).toEqual({
    remedy: "choose_model",
    failures: ROUTINE_AUTO_PAUSE_AFTER,
    pausedAt: NOW,
  });
});
