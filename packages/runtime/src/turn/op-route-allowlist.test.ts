import { expect, test } from "vitest";
import { isOpRoute, isReadOpRoute } from "./op-route-allowlist";

test("one skill's detail is a read op: the gateway has no doc for it", () => {
  expect(isOpRoute("skills/weekly-digest")).toBe(true);
  expect(isReadOpRoute("skills/weekly-digest")).toBe(true);
});

test("the skills list stays a view-doc read, never a read op", () => {
  expect(isReadOpRoute("skills")).toBe(false);
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
