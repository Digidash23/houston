import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  AGENT_CONTEXT_IDS,
  AGENT_ROLE_IDS,
} from "../src/lib/agent-role-catalog.ts";
import {
  isLeadershipRoleId,
  LEADERSHIP_ROLE_IDS,
} from "../src/lib/leadership-roles.ts";

describe("leadership roles", () => {
  it("lists the agreed positions, each once, in the survey's order", () => {
    deepStrictEqual(LEADERSHIP_ROLE_IDS, [
      "founder",
      "co_founder",
      "owner",
      "ceo",
      "president",
      "managing_director",
      "general_manager",
      "coo",
      "cfo",
      "cto",
      "cmo",
      "cro",
      "vp",
      "director",
      "head_of_department",
      "partner",
      "team_lead",
      "manager",
    ]);
    strictEqual(new Set(LEADERSHIP_ROLE_IDS).size, LEADERSHIP_ROLE_IDS.length);
  });

  it("never shares an id with the hire catalog, so no position is hireable", () => {
    const catalog = new Set<string>([...AGENT_ROLE_IDS, ...AGENT_CONTEXT_IDS]);
    deepStrictEqual(
      LEADERSHIP_ROLE_IDS.filter((id) => catalog.has(id)),
      [],
    );
  });

  it("never spells a survey sentinel, which the gateway stores beside them", () => {
    for (const sentinel of ["skipped", "something_else"]) {
      strictEqual(isLeadershipRoleId(sentinel), false);
    }
  });

  it("uses the gateway's id shape", () => {
    for (const id of LEADERSHIP_ROLE_IDS) {
      strictEqual(/^[a-z][a-z0-9_]*$/.test(id), true, id);
    }
  });

  it("recognises its own ids and nothing else", () => {
    strictEqual(isLeadershipRoleId("ceo"), true);
    strictEqual(isLeadershipRoleId("head_of_department"), true);
    strictEqual(isLeadershipRoleId("account_executive"), false);
    strictEqual(isLeadershipRoleId("CEO"), false);
    strictEqual(isLeadershipRoleId(undefined), false);
    strictEqual(isLeadershipRoleId(7), false);
  });
});
