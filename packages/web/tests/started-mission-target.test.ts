import { expect, test, vi } from "vitest";
import {
  openStartedMission,
  resolveStartedMissionAgent,
} from "../../../app/src/hooks/started-mission-target";
import { openAgentBoard } from "../../../app/src/lib/open-agent";
import type { Agent } from "../../../app/src/lib/types";
import { useUIStore } from "../../../app/src/stores/ui";

vi.mock("../../../app/src/lib/open-agent", () => ({ openAgentBoard: vi.fn() }));
vi.mock("../../../app/src/stores/ui", () => ({
  useUIStore: { getState: vi.fn() },
}));

const agent: Agent = {
  id: "agent-1",
  name: "Ada",
  folderPath: "/Ada",
  configId: "default",
  createdAt: "2026-09-28",
};

test("started mission target resolves a current employee by id or name", () => {
  expect(resolveStartedMissionAgent("agent-1", [agent])).toBe(agent);
  expect(resolveStartedMissionAgent("Ada", [agent])).toBe(agent);
  expect(resolveStartedMissionAgent("ada", [agent])).toBeUndefined();
  expect(resolveStartedMissionAgent("Ada", [])).toBeUndefined();
});

test("started mission opens the employee board and focuses its card", () => {
  const setActivityPanelId = vi.fn();
  vi.mocked(useUIStore.getState).mockReturnValue({
    setActivityPanelId,
  } as ReturnType<typeof useUIStore.getState>);
  openStartedMission(agent, "mission-1");
  expect(openAgentBoard).toHaveBeenCalledWith(
    "agent-1",
    expect.objectContaining({ onOpened: expect.any(Function) }),
  );
  const options = vi.mocked(openAgentBoard).mock.lastCall?.[1];
  options?.onOpened?.();
  expect(setActivityPanelId).toHaveBeenCalledWith("mission-1", {
    forceOpen: true,
  });
});
