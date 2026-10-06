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
const EDITORS = [
  "<RoutineRowScheduleEdit",
  "<RoutinesGrid",
  "<ScheduleBuilder",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("schedule editors get the plan's floor", () => {
  it("every editor mount passes freeScheduleMinInterval", () => {
    const mounts = sourceFiles(SRC).filter((file) => {
      const src = readFileSync(file, "utf8");
      return EDITORS.some((tag) => src.includes(`${tag}\n`));
    });
    ok(mounts.length >= 2, "routine screen + team routines grid");
    for (const file of mounts) {
      const src = readFileSync(file, "utf8");
      ok(
        src.includes("minIntervalMinutes={freeScheduleMinInterval(plan)}"),
        `${file} passes the floor`,
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
