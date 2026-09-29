import { expect, test, vi } from "vitest";
import {
  type InTreeMissionTitle,
  landedMissionTitle,
} from "./turn-mission-title-outcome";

const inTree: InTreeMissionTitle = {
  outcome: "written",
  ms: 40,
  written: { conversationId: "activity-m1", title: "Plan", fallback: "Pl..." },
};
const landed = (body?: string) => ({
  board: { landed: true, ...(body === undefined ? {} : { body }) },
});
const board = (title: string) =>
  JSON.stringify([{ id: "m1", title, status: "running" }]);

test("a landed card is read back against the title it was written with", () => {
  expect(landedMissionTitle(inTree, landed(board("Plan")))).toEqual({
    outcome: "written",
    ms: 40,
  });
  expect(landedMissionTitle(inTree, landed(board("Mine"))).outcome).toBe(
    "renamed",
  );
  expect(landedMissionTitle(inTree, landed(board("Pl..."))).outcome).toBe(
    "sync_lost",
  );
  expect(landedMissionTitle(inTree, landed("[]")).outcome).toBe("card_missing");
});

test("an unlanded board loses the title; unverifiable bytes trust the landing", () => {
  expect(landedMissionTitle(inTree, { board: { landed: false } }).outcome).toBe(
    "sync_lost",
  );
  expect(landedMissionTitle(inTree, landed()).outcome).toBe("written");
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(landedMissionTitle(inTree, landed("{")).outcome).toBe("written");
  expect(error).toHaveBeenCalledOnce();
  error.mockRestore();
});
