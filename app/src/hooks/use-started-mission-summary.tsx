import {
  ChatStartedMissionCard,
  startedMissions,
  type TurnEndSummary,
} from "@houston-ai/chat";
import { resolveAgentColor } from "@houston-ai/core";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../stores/agents";
import {
  openStartedMission,
  resolveStartedMissionAgent,
} from "./started-mission-target";

export function useStartedMissionSummary() {
  const agents = useAgentStore((state) => state.agents);
  const { t } = useTranslation("chat");
  return useCallback(
    (summary: TurnEndSummary) => {
      const missions = startedMissions(summary);
      if (missions.length === 0) return null;
      return (
        <div className="flex w-full flex-col gap-2 py-2">
          {missions.map((mission) => {
            const agent = resolveStartedMissionAgent(mission.agent, agents);
            return (
              <ChatStartedMissionCard
                key={mission.id}
                mission={mission}
                agentName={agent?.name ?? mission.agent}
                agentColor={agent ? resolveAgentColor(agent.color) : undefined}
                onOpen={
                  agent
                    ? () => openStartedMission(agent, mission.id)
                    : undefined
                }
                labels={{
                  heading: (name) => t("startedMission.heading", { name }),
                  open: t("startedMission.open"),
                  openMission: (title) =>
                    t("startedMission.openMission", { title }),
                  unavailable: t("startedMission.unavailable"),
                }}
              />
            );
          })}
        </div>
      );
    },
    [agents, t],
  );
}
