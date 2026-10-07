import { describe, expect, it } from "vitest";
import { viewerIsRoutineCreator } from "./routine-creator";

describe("viewerIsRoutineCreator", () => {
  it("a routine naming no creator is the viewer's, session or not", () => {
    expect(viewerIsRoutineCreator(undefined, null)).toBe(true);
    expect(viewerIsRoutineCreator(undefined, "u-alice")).toBe(true);
  });

  it("a named creator must be the viewer", () => {
    expect(viewerIsRoutineCreator("u-alice", "u-alice")).toBe(true);
    expect(viewerIsRoutineCreator("u-alice", "u-bob")).toBe(false);
    expect(viewerIsRoutineCreator("u-alice", null)).toBe(false);
    expect(viewerIsRoutineCreator("u-alice", undefined)).toBe(false);
  });
});
