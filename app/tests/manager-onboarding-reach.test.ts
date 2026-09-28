import { deepStrictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { Capabilities } from "@houston/engine-adapter";
import { closingManagerVariant } from "../src/lib/manager-onboarding/closing-script.ts";
import { managerReach } from "../src/lib/manager-onboarding/manager-reach.ts";

const desktop: Capabilities = {
  profile: "local",
  revealInOs: true,
  terminal: true,
  tunnel: false,
  codeExecution: "local-bash",
  providers: ["anthropic"],
  openaiCompatible: true,
  integrations: ["composio"],
  sharedSkills: true,
};

describe("managerReach", () => {
  it("a desktop connects tools but has no shared space to invite into", () => {
    deepStrictEqual(managerReach(desktop), { invite: false, connect: true });
  });

  it("the hosted cloud serves spaces, so teammates can be invited", () => {
    deepStrictEqual(managerReach({ ...desktop, spaces: true }), {
      invite: true,
      connect: true,
    });
  });

  it("a deployment with no integrations provider connects nothing", () => {
    deepStrictEqual(managerReach({ ...desktop, integrations: [] }), {
      invite: false,
      connect: false,
    });
  });

  it("unknown capabilities promise neither", () => {
    deepStrictEqual(managerReach(null), { invite: false, connect: false });
  });
});

describe("closingManagerVariant", () => {
  it("tells only what reaches", () => {
    deepStrictEqual(
      [
        { invite: true, connect: true },
        { invite: true, connect: false },
        { invite: false, connect: true },
        { invite: false, connect: false },
        undefined,
      ].map(closingManagerVariant),
      ["all", "invite", "connect", "core", "core"],
    );
  });
});
