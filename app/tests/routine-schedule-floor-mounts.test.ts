import { ok } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A Free user can't pick a schedule under the plan's minimum interval: every
 * app mount of a schedule editor hands it the SDK's floor. The node runner has
 * no DOM, so (per the repo's React-test idiom) this asserts on source.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const EDITOR_TAG =
  /<(ScheduleBuilder|RoutinesGrid|RoutineRowScheduleEdit)[\s/>]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("schedule editors get the creator's floor", () => {
  it("every editor mount passes the floor from useRoutineScheduleFloor", () => {
    const mounts = sourceFiles(SRC).filter((file) => {
      const src = readFileSync(file, "utf8");
      return EDITOR_TAG.test(src);
    });
    ok(mounts.length >= 2, "routine screen + team routines grid");
    for (const file of mounts) {
      const src = readFileSync(file, "utf8");
      ok(
        src.includes("useRoutineScheduleFloor()") &&
          /(minIntervalMinutes|scheduleFloor)=\{/.test(src),
        `${file} passes its creator's floor`,
      );
    }
  });

  it("each save backstop judges with the same creator floor", () => {
    for (const rel of [
      "components/agent/routine-screen-sections.tsx",
      "components/team-view/team-routines/use-team-routine-actions.ts",
    ]) {
      const src = readFileSync(join(SRC, rel), "utf8");
      ok(src.includes("useRoutineScheduleFloor()"), `${rel} reads the floor`);
      ok(src.includes("scheduleFloorAllows("), `${rel} backstops with it`);
      ok(
        !src.includes("freeScheduleAllowed"),
        `${rel} drops the plan-only gate`,
      );
    }
  });

  it("every language names the floor in the stepper hint", () => {
    for (const lang of ["en", "es", "pt"]) {
      const json = JSON.parse(
        readFileSync(join(SRC, "locales", lang, "routines.json"), "utf8"),
      ) as { schedule: { minIntervalHint?: string } };
      ok(
        json.schedule.minIntervalHint?.includes("{minutes}"),
        `${lang} schedule.minIntervalHint carries {minutes}`,
      );
    }
  });
});
