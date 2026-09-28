import { describe, expect, it } from "vitest";
import {
  canRetryMoveError,
  classifyMoveError,
  isMoveRefusalCode,
  isMoveRefusedBeforeStart,
} from "./move-refusals";

describe("classifyMoveError", () => {
  it.each([
    "unsupported_move",
    "unmovable_volume",
    "needs_upgrade",
    "name_taken",
  ] as const)("passes the C8 refusal %s through", (code) => {
    expect(classifyMoveError(code)).toBe(code);
    expect(isMoveRefusalCode(code)).toBe(true);
  });

  it("maps anything else to unknown", () => {
    for (const code of ["weird", "timeout", undefined, null]) {
      expect(classifyMoveError(code)).toBe("unknown");
      expect(isMoveRefusalCode(code)).toBe(false);
    }
  });
});

describe("which move failures a retry can fix", () => {
  it.each([
    "unsupported_move",
    "needs_upgrade",
    "timeout",
    "unknown",
  ] as const)("%s allows a retry", (kind) => {
    expect(canRetryMoveError(kind)).toBe(true);
  });

  it("a storage the gateway cannot move is terminal", () => {
    expect(canRetryMoveError("unmovable_volume")).toBe(false);
  });

  it("a name the team already holds needs a rename, not a retry", () => {
    expect(canRetryMoveError("name_taken")).toBe(false);
  });
});

describe("a move refused before anything started", () => {
  it("is name_taken alone: no lock is held, so nothing is left to resume", () => {
    expect(isMoveRefusedBeforeStart("name_taken")).toBe(true);
    for (const code of [
      "unsupported_move",
      "unmovable_volume",
      "needs_upgrade",
      "move_in_progress",
      undefined,
    ]) {
      expect(isMoveRefusedBeforeStart(code)).toBe(false);
    }
  });
});
