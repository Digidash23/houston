import { describe, expect, it } from "vitest";
import { isRoutineNotFoundBody, ROUTINE_NOT_FOUND } from "./routine-refusal";

describe("isRoutineNotFoundBody", () => {
  it("reads the typed refusal", () => {
    expect(
      isRoutineNotFoundBody({
        error: "routine not found",
        code: ROUTINE_NOT_FOUND,
      }),
    ).toBe(true);
    expect(isRoutineNotFoundBody({ code: "routine_not_found" })).toBe(true);
  });

  it("reads the bare reason older hosts answer", () => {
    expect(isRoutineNotFoundBody({ error: "routine not found" })).toBe(true);
  });

  it("is false for any other body", () => {
    expect(isRoutineNotFoundBody({ error: "agent not found" })).toBe(false);
    expect(isRoutineNotFoundBody({ error: "run not found" })).toBe(false);
    expect(isRoutineNotFoundBody({ error: "Routine not found" })).toBe(false);
    expect(
      isRoutineNotFoundBody({ error: "routine not found", code: "other" }),
    ).toBe(false);
    expect(isRoutineNotFoundBody("routine not found")).toBe(false);
    expect(isRoutineNotFoundBody(null)).toBe(false);
  });
});
