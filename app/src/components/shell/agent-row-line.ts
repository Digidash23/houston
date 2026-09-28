import type { Agent } from "../../lib/types.ts";
import type { AgentActivitySummary } from "./agent-activity-summary-model.ts";
import type { HeadlineStatus } from "./mission-headline-model.ts";

/** What an agent row's second line says. */
export type AgentRowLine =
  | { kind: "mission"; status: HeadlineStatus; title: string }
  | { kind: "firstDay" }
  | { kind: "role"; role: string }
  | { kind: "empty" };

/**
 * The row's second line, first match wins:
 *
 * 1. The headline mission (`mission-headline-model.ts`): what the employee is
 *    doing, or what waits on the person, with its status.
 * 2. An invitation to start its first day, when `invitesFirstDay` says so
 *    (`first-day-invites.ts`: task list CONFIRMED empty, first day pending,
 *    and this caller may start it). The row opens the employee's board, whose
 *    empty state is that very start button.
 * 3. Its role, which is also what an unconfirmed history shows, so a veteran
 *    never reads as brand new while its tasks load.
 */
export function agentRowLine(
  agent: Pick<Agent, "role">,
  summary: AgentActivitySummary,
  invitesFirstDay: boolean,
): AgentRowLine {
  const { headline } = summary;
  if (headline) {
    return {
      kind: "mission",
      status: headline.status,
      title: headline.title,
    };
  }
  if (summary.history === "none" && invitesFirstDay)
    return { kind: "firstDay" };
  return agent.role ? { kind: "role", role: agent.role } : { kind: "empty" };
}
