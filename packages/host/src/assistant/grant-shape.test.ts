import { expect, test } from "vitest";
import { grantCovers } from "./grant-shape";

test("a hire grant covers only a name, palette color and plain instructions", () => {
  expect(grantCovers("createAgent", { name: "Writer" })).toBe(true);
  expect(
    grantCovers("createAgent", {
      name: "Writer",
      color: "teal",
      seed: { claudeMd: "Write clearly" },
    }),
  ).toBe(true);
  expect(
    grantCovers("createAgent", {
      name: "Writer",
      seed: { claudeMd: "Write", seeds: { "file.md": "content" } },
    }),
  ).toBe(false);
  expect(
    grantCovers("createAgent", { name: "Writer", seed: { seeds: {} } }),
  ).toBe(false);
  expect(grantCovers("createAgent", { name: "Writer", color: "custom" })).toBe(
    false,
  );
  expect(grantCovers("createAgent", { name: "Writer", extra: true })).toBe(
    false,
  );
  expect(grantCovers("createSkill", { name: "Writer" })).toBe(false);
  expect(grantCovers("deleteAgent", { name: "Writer" })).toBe(false);
});
