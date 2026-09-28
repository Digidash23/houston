import { deepStrictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { Capabilities } from "@houston/engine-adapter";
import { agentSettingsSections } from "../src/components/agent-settings/agent-settings-nav";

const capabilities = (enabled: boolean): Capabilities => ({
  profile: "local",
  revealInOs: false,
  terminal: false,
  tunnel: false,
  codeExecution: "local",
  providers: [],
  openaiCompatible: false,
  integrations: [],
  agentDelegation: enabled,
});

describe("Teamwork settings navigation", () => {
  it("appears after Skills only when the host supports delegation", () => {
    deepStrictEqual(agentSettingsSections(capabilities(true)), [
      "manage",
      "job-description",
      "skills",
      "delegation",
      "learnings",
    ]);
    deepStrictEqual(agentSettingsSections(capabilities(false)), [
      "manage",
      "job-description",
      "skills",
      "learnings",
    ]);
  });
});
