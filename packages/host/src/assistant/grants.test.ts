import { expect, test } from "vitest";
import { GRANT_TTL_MS, GrantStore } from "./grants";

const scope = {
  agentId: "Personal/.assistant",
  conversationId: "onboarding",
  operation: "createAgent" as const,
};

test("a grant is single use and scoped to its conversation and person", () => {
  const grants = new GrantStore();
  grants.issue({ ...scope, actor: "user-a", requiresActor: true });
  expect(
    grants.spend({ ...scope, conversationId: "other", actor: "user-a" }),
  ).toBeUndefined();
  expect(grants.spend({ ...scope, actor: "user-b" })).toBeUndefined();
  expect(grants.spend({ ...scope, actor: "user-a" })).toBeDefined();
  expect(grants.spend({ ...scope, actor: "user-a" })).toBeUndefined();
});

test("a grant with no hire expires harmlessly", () => {
  let now = 100;
  const grants = new GrantStore(() => now);
  grants.issue({ ...scope, actor: "user-a", requiresActor: false });
  now += GRANT_TTL_MS;
  expect(grants.spend(scope)).toBeUndefined();
});

test("a held grant comes back only when the app refused its call", () => {
  const grants = new GrantStore();
  grants.issue({ ...scope, actor: "u", requiresActor: false });
  const spent = grants.spend(scope);
  if (!spent) throw new Error("the grant should spend");
  grants.hold("r1", spent);
  grants.settle("r1", "createAgent", false);
  expect(grants.spend(scope)).toBeUndefined();
  grants.issue({ ...scope, actor: "u", requiresActor: false });
  const again = grants.spend(scope);
  if (!again) throw new Error("the grant should spend");
  grants.hold("r2", again);
  grants.settle("r2", "createAgent", true);
  expect(grants.spend(scope)).toBeDefined();
});
