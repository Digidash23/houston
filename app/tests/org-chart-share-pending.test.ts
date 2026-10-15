import { deepStrictEqual } from "node:assert";
import { describe, it } from "node:test";
import { createPendingRuns } from "../src/components/organization/org-chart-share-pending.ts";

describe("createPendingRuns", () => {
  it("lets only the latest run clear the flag", () => {
    const flag: boolean[] = [];
    const begin = createPendingRuns((pending) => flag.push(pending));
    const first = begin();
    first(true);
    const second = begin();
    second(true);
    // The first run's upload settles after the second run started.
    first(false);
    deepStrictEqual(flag, [true, true]);
    second(false);
    deepStrictEqual(flag, [true, true, false]);
  });

  it("leaves a lone run in charge of its own flag", () => {
    const flag: boolean[] = [];
    const run = createPendingRuns((pending) => flag.push(pending))();
    run(true);
    run(false);
    deepStrictEqual(flag, [true, false]);
  });
});
