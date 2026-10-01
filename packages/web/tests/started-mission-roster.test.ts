import { expect, test, vi } from "vitest";
import { resolveStartedMissionAgent } from "../../../app/src/hooks/started-mission-target";
import { planInvalidation } from "../../../app/src/lib/agent-invalidation-plan";
import { tauriAgents } from "../../../app/src/lib/agents-facade";
import type { Agent } from "../../../app/src/lib/types";
import { useAgentStore } from "../../../app/src/stores/agents";

vi.mock("../../../app/src/lib/agents-facade", () => ({
  tauriAgents: { list: vi.fn() },
}));
vi.mock("../../../app/src/lib/tauri", () => ({
  tauriPreferences: { set: vi.fn() },
}));

test("an agent-created event reloads the Manager's new employee for the Open action", async () => {
  const agent: Agent = {
    id: "new-agent",
    name: "Document Collector",
    folderPath: "Personal/Document Collector",
    configId: "default",
    createdAt: "2026-09-28",
  };
  useAgentStore.getState().reset();
  vi.mocked(tauriAgents.list).mockResolvedValue([agent]);

  const plan = planInvalidation(
    { type: "AgentsChanged", data: { workspace_id: "Personal" } },
    { workspaceId: "default" },
  );
  expect(plan.reloadAgentsWorkspace).toBe("default");
  if (!plan.reloadAgentsWorkspace) throw new Error("roster reload not planned");
  await useAgentStore.getState().loadAgents(plan.reloadAgentsWorkspace, {
    silent: true,
  });

  expect(tauriAgents.list).toHaveBeenCalledWith("default");
  expect(
    resolveStartedMissionAgent(
      "Document Collector",
      useAgentStore.getState().agents,
    ),
  ).toBe(agent);
});
