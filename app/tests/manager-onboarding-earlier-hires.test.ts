import { deepStrictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  earlierHireIds,
  earlierHires,
} from "../src/lib/manager-onboarding/earlier-hires.ts";

const ada = { id: "a1", name: "Ada" };
const bo = { id: "b2", name: "Bo" };

describe("the AI Employees a resumed first run already hired", () => {
  it("lists nobody before the team step has taken its snapshot", () => {
    deepStrictEqual(earlierHires([ada, bo], null), []);
  });

  it("lists whoever existed when the team step opened", () => {
    deepStrictEqual(earlierHires([ada, bo], earlierHireIds([ada, bo])), [
      ada,
      bo,
    ]);
  });

  it("never lists this run's own hires as earlier ones", () => {
    const ids = earlierHireIds([ada]);
    deepStrictEqual(earlierHires([ada, bo], ids), [ada]);
  });

  it("reads the live list, so a rename or a removal since shows as it is", () => {
    const ids = earlierHireIds([ada, bo]);
    const renamed = { ...ada, name: "Ada Lovelace" };
    deepStrictEqual(earlierHires([renamed], ids), [renamed]);
  });
});
