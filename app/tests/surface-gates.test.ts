import { strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { Capabilities } from "@houston/engine-adapter";
import type { AssistantDiscovery } from "../src/lib/assistant-discovery-state.ts";
import { surfaceGatesFor } from "../src/lib/surface-gates-model.ts";

const owner: Capabilities = {
  multiplayer: true,
  role: "owner",
} as unknown as Capabilities;

const discovering: AssistantDiscovery = {
  handle: null,
  isLoading: true,
  unavailable: false,
  failure: null,
};
const settledAbsent: AssistantDiscovery = {
  handle: null,
  isLoading: false,
  unavailable: true,
  failure: null,
};
/** Discovery's ladder spent on a pod that never woke. */
const settledFailed: AssistantDiscovery = {
  handle: null,
  isLoading: false,
  unavailable: false,
  failure: "transient",
};
const present: AssistantDiscovery = {
  handle: { agentId: "a", workspaceId: "w" } as never,
  isLoading: false,
  unavailable: false,
  failure: null,
};

describe("surfaceGatesFor", () => {
  it("keeps the assistant row up while discovery is still loading", () => {
    strictEqual(
      surfaceGatesFor({
        capabilities: owner,
        isTeam: false,
        assistant: discovering,
        capabilitiesLoading: false,
      }).showAssistant,
      true,
    );
  });

  it("keeps the assistant row up when discovery keeps FAILING", () => {
    // A manager that cannot start still exists. Dropping the row here left the
    // user with no way back to it at all (PRODUCT-1795); the screen behind the
    // row is what says what went wrong.
    strictEqual(
      surfaceGatesFor({
        capabilities: owner,
        isTeam: false,
        assistant: settledFailed,
        capabilitiesLoading: false,
      }).showAssistant,
      true,
    );
  });

  it("drops the assistant row only once discovery settles unavailable", () => {
    strictEqual(
      surfaceGatesFor({
        capabilities: owner,
        isTeam: false,
        assistant: settledAbsent,
        capabilitiesLoading: false,
      }).showAssistant,
      false,
    );
    strictEqual(
      surfaceGatesFor({
        capabilities: owner,
        isTeam: false,
        assistant: present,
        capabilitiesLoading: false,
      }).showAssistant,
      true,
    );
  });

  it("reads ready from capabilities alone, never from discovery", () => {
    strictEqual(
      surfaceGatesFor({
        capabilities: owner,
        isTeam: false,
        assistant: discovering,
        capabilitiesLoading: false,
      }).ready,
      true,
    );
    strictEqual(
      surfaceGatesFor({
        capabilities: null,
        isTeam: false,
        assistant: present,
        capabilitiesLoading: true,
      }).ready,
      false,
    );
  });

  it("requires the loading flag rather than defaulting it to settled", () => {
    // `ready: !capabilitiesLoading` over an OPTIONAL field read every caller
    // that forgot it as "the gates have settled" — the one answer that lets a
    // guard drop an owner out of a screen they can reach.
    const src = readFileSync(
      new URL("../src/lib/surface-gates-model.ts", import.meta.url),
      "utf8",
    );
    strictEqual(src.includes("capabilitiesLoading?:"), false);
  });

  it("keeps Billing and the Danger zone to the team space that has them", () => {
    // Both are destinations an agent's hands-on errand can send someone to, so
    // a gate that said yes off a personal space would hand them a button to a
    // section that is not rendered anywhere.
    const spaces = {
      ...owner,
      spaces: true,
      teamBilling: true,
      workspaceDelete: true,
    } as never;
    const team = surfaceGatesFor({
      capabilities: spaces,
      isTeam: true,
      assistant: present,
      capabilitiesLoading: false,
    });
    strictEqual(team.showBilling, true);
    strictEqual(team.showWorkspaceDanger, true);
    const personal = surfaceGatesFor({
      capabilities: spaces,
      isTeam: false,
      assistant: present,
      capabilitiesLoading: false,
    });
    strictEqual(personal.showBilling, false);
    strictEqual(personal.showWorkspaceDanger, false);
    // A plain member of the same team sees neither.
    const member = surfaceGatesFor({
      capabilities: {
        multiplayer: true,
        role: "user",
        spaces: true,
        workspaceDelete: true,
      } as never,
      isTeam: true,
      assistant: present,
      capabilitiesLoading: false,
    });
    strictEqual(member.showBilling, false);
    strictEqual(member.showWorkspaceDanger, false);
  });

  it("keeps Billing off a deployment that bills no teams", () => {
    // No `teamBilling`: every billing read 503s, so the tab, the query and the
    // hands-on billing errand all stay shut while the Danger zone remains.
    const gates = surfaceGatesFor({
      capabilities: { ...owner, spaces: true, workspaceDelete: true } as never,
      isTeam: true,
      assistant: present,
      capabilitiesLoading: false,
    });
    strictEqual(gates.showBilling, false);
    strictEqual(gates.showWorkspaceDanger, true);
  });

  it("keeps the Danger zone off a deployment that cannot delete a space", () => {
    strictEqual(
      surfaceGatesFor({
        capabilities: { ...owner, spaces: true } as never,
        isTeam: true,
        assistant: present,
        capabilitiesLoading: false,
      }).showWorkspaceDanger,
      false,
    );
  });

  it("keeps the AI Models hub for every member of a team workspace", () => {
    const member = { multiplayer: true, role: "user" } as never;
    const gates = surfaceGatesFor({
      capabilities: member,
      isTeam: true,
      assistant: present,
      capabilitiesLoading: false,
    });
    // The org-level narrowing lives in the screen, not the menu.
    strictEqual(gates.showAiModels, true);
    strictEqual("showSkills" in gates, false, "no Skills screen to gate");
  });

  it("offers API keys only where the deployment serves the public API", () => {
    const at = (capabilities: unknown) =>
      surfaceGatesFor({
        capabilities: capabilities as never,
        isTeam: false,
        assistant: present,
        capabilitiesLoading: false,
      }).showApiKeys;
    strictEqual(at({ apiKeys: true }), true);
    strictEqual(at({}), false);
    strictEqual(at(null), false);
  });

  it("keeps the skill acts that reach every employee to the space owner", () => {
    // Share to workspace, Enable for all and Delete for all edit every
    // employee's skills at once: that is the owner's call, not a manager's.
    const as = (role: string) =>
      surfaceGatesFor({
        capabilities: { multiplayer: true, role } as never,
        isTeam: true,
        assistant: present,
        capabilitiesLoading: false,
      }).manageWorkspaceSkills;
    strictEqual(as("owner"), true);
    strictEqual(as("admin"), false);
    strictEqual(as("user"), false);
    // Nothing before the deployment has described itself: unanswered
    // capabilities read as single player, which would show anyone the acts.
    strictEqual(
      surfaceGatesFor({
        capabilities: null,
        isTeam: true,
        assistant: present,
        capabilitiesLoading: true,
      }).manageWorkspaceSkills,
      false,
    );
    // Single player: one human, everything is theirs.
    strictEqual(
      surfaceGatesFor({
        capabilities: null,
        isTeam: false,
        assistant: present,
        capabilitiesLoading: false,
      }).manageWorkspaceSkills,
      true,
    );
  });
});
