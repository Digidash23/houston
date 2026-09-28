import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  employeeStatusView,
  paletteColumns,
  paletteKeyStep,
} from "../src/components/employee-card/employee-card-model.ts";
import {
  employeeNameIssue,
  firstNameIssueIndex,
  visibleNameIssue,
} from "../src/components/employee-card/employee-name-validation.ts";

describe("employee name validation", () => {
  it("requires a name", () => {
    strictEqual(employeeNameIssue("", []), "required");
    strictEqual(employeeNameIssue("   ", []), "required");
    strictEqual(employeeNameIssue("Ava", []), null);
  });

  it("keeps the host's own rules", () => {
    strictEqual(employeeNameIssue("Ava", ["ava"]), "taken");
    strictEqual(employeeNameIssue("a/b", []), "invalidChars");
  });

  it("waits for a submit before calling a blank name out", () => {
    strictEqual(visibleNameIssue("required", false), null);
    strictEqual(visibleNameIssue("required", true), "required");
    strictEqual(visibleNameIssue("taken", false), "taken");
    strictEqual(visibleNameIssue(null, true), null);
  });

  it("finds the first card to fix", () => {
    strictEqual(firstNameIssueIndex([null, null]), null);
    strictEqual(firstNameIssueIndex([null, "required", "taken"]), 1);
  });
});

describe("employee card status", () => {
  it("omits the draft status and marks progress on the foot", () => {
    deepStrictEqual(employeeStatusView("draft"), {
      mark: null,
      dimPortrait: false,
      offersActions: false,
    });
    deepStrictEqual(employeeStatusView("joining"), {
      mark: "spinner",
      dimPortrait: true,
      offersActions: false,
    });
    strictEqual(employeeStatusView("hired").mark, "successDot");
    deepStrictEqual(employeeStatusView("failed"), {
      mark: "alert",
      dimPortrait: false,
      offersActions: true,
    });
  });
});

describe("employee color palette keys", () => {
  it("reads the columns from the rows the swatches lay out in", () => {
    strictEqual(paletteColumns([0, 0, 0, 0, 0, 28, 28, 28, 28, 28]), 5);
    strictEqual(paletteColumns([0, 0, 0, 0, 24, 24, 24, 24, 48, 48]), 4);
    strictEqual(paletteColumns([0, 0, 0]), 3);
    strictEqual(paletteColumns([]), 0);
  });

  it("walks the row, jumps a row, and wraps around the ten", () => {
    strictEqual(paletteKeyStep("ArrowRight", 0, 10, 5), 1);
    strictEqual(paletteKeyStep("ArrowLeft", 0, 10, 5), 9);
    strictEqual(paletteKeyStep("ArrowDown", 2, 10, 5), 7);
    strictEqual(paletteKeyStep("ArrowUp", 2, 10, 5), 7);
    strictEqual(paletteKeyStep("ArrowDown", 2, 10, 4), 6);
    strictEqual(paletteKeyStep("ArrowUp", 1, 10, 4), 7);
    strictEqual(paletteKeyStep("ArrowRight", 9, 10, 5), 0);
    strictEqual(paletteKeyStep("Home", 6, 10, 5), 0);
    strictEqual(paletteKeyStep("End", 1, 10, 5), 9);
    strictEqual(paletteKeyStep("Enter", 1, 10, 5), null);
    strictEqual(paletteKeyStep("Escape", 1, 10, 5), null);
    strictEqual(paletteKeyStep("Tab", 1, 10, 5), null);
  });
});
