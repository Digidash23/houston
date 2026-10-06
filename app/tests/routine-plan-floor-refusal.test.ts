import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { surfacePlanMinInterval } from "../src/lib/plan-min-interval.ts";
import { classifyQuietError } from "../src/lib/quiet-error-class.ts";
import { toastRoutineWriteFailure } from "../src/lib/routine-write-failure.ts";
import { useUIStore } from "../src/stores/ui.ts";

/**
 * A routine save the engine refused under the saver's plan floor (`400
 * plan_min_interval`) is an expected business state: ONE info toast with the
 * plan's copy, from the engine-call layer, and nothing reported. The routine
 * screen and its model row attach their own failure handlers; both stand down
 * for it instead of stacking a red "couldn't save" toast and a Sentry report.
 */

const SRC = join(import.meta.dirname, "../src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** The adapter's `HoustonEngineError` shape for the refusal. */
function refusal(): Error {
  return Object.assign(new Error("HTTP 400"), {
    name: "HoustonEngineError",
    status: 400,
    body: {
      error:
        "This person's plan runs a scheduled task at most once every 15 minutes.",
      code: "plan_min_interval",
      minIntervalMinutes: 15,
    },
  });
}

const drain = () => {
  for (const t of useUIStore.getState().toasts)
    useUIStore.getState().dismissToast(t.id);
};
afterEach(drain);

describe("the plan-floor refusal is a quiet expected class", () => {
  it("is classified as plan_min_interval; another 400 is not", () => {
    strictEqual(classifyQuietError(refusal()), "plan_min_interval");
    const badCron = Object.assign(new Error("HTTP 400"), {
      status: 400,
      body: { error: "invalid schedule" },
    });
    strictEqual(classifyQuietError(badCron), null);
  });

  it("every reporting path skips it before any capture", () => {
    const report = read("lib/error-report.ts");
    const body = report.slice(report.indexOf("export function reportError("));
    const skip = body.indexOf('quiet === "plan_min_interval"');
    ok(skip !== -1 && skip < body.indexOf("reportQuietError("), "reportError");
    ok(skip < body.indexOf("sentryCapture("), "no per-event capture");
    const toast = read("lib/error-toast.ts");
    ok(
      toast.includes('case "plan_min_interval":') &&
        toast.includes("showPlanFloorToast();"),
      "showErrorToast shows the plan copy instead of reporting",
    );
    const tauri = read("lib/tauri.ts");
    ok(
      tauri.includes("if (surfacePlanMinInterval(err)) return;"),
      "the engine-call layer surfaces it before its bug path",
    );
  });
});

describe("the routine screen and model row on a plan-floor refusal", () => {
  it("the engine-call layer shows exactly one info toast", () => {
    ok(surfacePlanMinInterval(refusal()));
    const toasts = useUIStore.getState().toasts;
    strictEqual(toasts.length, 1);
    strictEqual(toasts[0]?.variant, "info");
  });

  it("their own failure handlers add no toast and report nothing", () => {
    for (const [title, command] of [
      ["Couldn't save", "update_routine"],
      ["Couldn't change the model", "set_routine_model"],
    ] as const) {
      const toasts: unknown[] = [];
      const reported: string[] = [];
      toastRoutineWriteFailure(
        refusal(),
        { title, command },
        {
          addToast: (t) => toasts.push(t),
          describe: (c) => {
            reported.push(c);
            return "generic";
          },
        },
      );
      deepStrictEqual(toasts, []);
      deepStrictEqual(reported, []);
    }
  });

  it("any other failure keeps its red toast and one report", () => {
    const toasts: unknown[] = [];
    const reported: string[] = [];
    toastRoutineWriteFailure(
      new Error("boom"),
      { title: "Couldn't save", command: "update_routine" },
      {
        addToast: (t) => toasts.push(t),
        describe: (c) => {
          reported.push(c);
          return "generic";
        },
      },
    );
    deepStrictEqual(toasts, [
      { title: "Couldn't save", description: "generic", variant: "error" },
    ]);
    deepStrictEqual(reported, ["update_routine"]);
  });

  it("both components route their failures through the shared handler", () => {
    for (const rel of [
      "components/agent/routine-screen.tsx",
      "components/agent/routine-model-selector.tsx",
    ]) {
      const src = read(rel);
      ok(src.includes("toastRoutineWriteFailure("), rel);
      ok(!/description: genericErrorDescription\(/.test(src), rel);
    }
  });
});
