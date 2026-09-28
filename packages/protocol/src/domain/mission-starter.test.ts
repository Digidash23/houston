import { describe, expect, test } from "vitest";
import { isMissionStarter, MISSION_STARTERS } from "./mission-starter";

describe("isMissionStarter", () => {
  test.each(MISSION_STARTERS)("accepts %s", (starter) => {
    expect(isMissionStarter(starter)).toBe(true);
  });

  test.each([
    "person",
    "Houston",
    "",
    undefined,
    null,
    1,
    {},
  ])("rejects %j", (value) => {
    expect(isMissionStarter(value)).toBe(false);
  });
});
