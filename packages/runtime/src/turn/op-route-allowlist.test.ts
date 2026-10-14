import { expect, test } from "vitest";
import { isOpRoute, isReadOpRoute } from "./op-route-allowlist";

test("one skill's detail is a read op: the gateway has no doc for it", () => {
  expect(isOpRoute("skills/weekly-digest")).toBe(true);
  expect(isReadOpRoute("skills/weekly-digest")).toBe(true);
});

test("the family lists are read ops: the gateway's fallback when its doc read cannot answer", () => {
  for (const rest of [
    "skills",
    "routines",
    "routine_runs",
    "learnings",
    "config",
  ]) {
    expect(isOpRoute(rest), rest).toBe(true);
    expect(isReadOpRoute(rest), rest).toBe(true);
  }
});

test("activities, providers and item reads stay refused as read ops", () => {
  for (const rest of [
    "activities",
    "providers",
    "routines/r1",
    "routine_runs/run-1",
    "learnings/l1",
    "config/x",
    "routinesx",
    "xroutines",
  ])
    expect(isReadOpRoute(rest), rest).toBe(false);
});

test("remote-skills shapes no host handler serves are not op routes", () => {
  for (const rest of [
    "skills/repo/install",
    "skills/community/install",
    "skills/community/search",
  ]) {
    expect(isOpRoute(rest)).toBe(false);
    expect(isReadOpRoute(rest)).toBe(false);
  }
});
