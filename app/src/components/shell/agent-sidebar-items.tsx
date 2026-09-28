import type { SidebarItem } from "@houston-ai/layout";
import type { Agent } from "../../lib/types";
import type { AgentActivitySummary } from "./agent-activity-summary-model";
import { agentRowLine } from "./agent-row-line";
import { AgentRowLineText } from "./agent-row-parts";
import {
  AgentSidebarIcon,
  NeedsYouChip,
  NewAgentChip,
} from "./agent-sidebar-status";

/** Everything an agent row needs beyond the agents themselves. */
export interface AgentItemArgs {
  summaries: Record<string, AgentActivitySummary>;
  runningLabel: (count: number) => string;
  needsYouLabel: (count: number) => string;
  /** The badge on an employee that has never been given work. */
  newLabel: string;
  /** Whether the row invites the person to start this employee's first day
   *  (`first-day-invites.ts`: confirmed empty, first day pending, and this
   *  caller may start it), so the row never invites a click the board then
   *  has no button for. */
  invitesFirstDay: (agent: Agent) => boolean;
}

interface BuildAgentSidebarItemsArgs extends AgentItemArgs {
  agents: Agent[];
}

const NO_ACTIVITY: AgentActivitySummary = {
  needsYouCount: 0,
  runningCount: 0,
  headline: null,
  history: "unknown",
};

/**
 * The rail's agent rows, laid out like a message list: the name, then its
 * line (`agentRowLine`) with a badge at its end (the needs-you count, or "New"
 * on an employee whose first day is still ahead), and the running ring around
 * the avatar while the employee is at work. Copying, publishing and deleting an AI Employee
 * live in its Settings, so the row stays one quiet target.
 *
 * Everything here is already in hand (the conversation sweep the badges use,
 * the listing's role): no job description is read, so painting the rail never
 * wakes an employee's pod on its own.
 */
export function buildAgentSidebarItems({
  agents,
  summaries,
  runningLabel,
  needsYouLabel,
  newLabel,
  invitesFirstDay,
}: BuildAgentSidebarItemsArgs): SidebarItem[] {
  return agents.map((agent) => {
    const summary = summaries[agent.id] ?? NO_ACTIVITY;
    const line = agentRowLine(agent, summary, invitesFirstDay(agent));
    return {
      id: agent.id,
      name: agent.name,
      subtitle: <AgentRowLineText line={line} />,
      icon: (
        <AgentSidebarIcon
          color={agent.color}
          running={summary.runningCount > 0}
          runningLabel={runningLabel(summary.runningCount)}
        />
      ),
      ...(summary.needsYouCount > 0
        ? {
            trailing: (
              <NeedsYouChip
                count={summary.needsYouCount}
                label={needsYouLabel(summary.needsYouCount)}
              />
            ),
          }
        : line.kind === "firstDay"
          ? { trailing: <NewAgentChip label={newLabel} /> }
          : {}),
    };
  });
}
