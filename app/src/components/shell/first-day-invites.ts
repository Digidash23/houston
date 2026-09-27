import type { WorkHistory } from "./agent-activity-summary-model.ts";

/**
 * Which employees' rows invite the person to start their first day: those
 * whose task list is CONFIRMED empty this session, whose first day is still
 * pending in their config, and whom this caller may start (the board's own
 * rule). Anything short of all three would lead a click to a board with no
 * start button. Pure, so node-testable.
 */
export function firstDayInviteIds<
  A extends { id: string; folderPath: string },
>(input: {
  agents: readonly A[];
  history: (agentId: string) => WorkHistory;
  canStart: (agent: A) => boolean;
  /** The employee's config `firstDay`, or undefined while it is unread. */
  firstDay: (folderPath: string) => string | undefined;
}): Set<string> {
  const ids = new Set<string>();
  for (const agent of input.agents) {
    if (input.history(agent.id) !== "none") continue;
    if (!input.canStart(agent)) continue;
    if (input.firstDay(agent.folderPath) !== "pending") continue;
    ids.add(agent.id);
  }
  return ids;
}

/** The employees whose config the invite needs read: confirmed-empty ones the
 *  caller may start. Few (new, unused employees), so reading them wakes no
 *  one who is at work. */
export function firstDayCandidates<A extends { id: string }>(input: {
  agents: readonly A[];
  history: (agentId: string) => WorkHistory;
  canStart: (agent: A) => boolean;
}): A[] {
  return input.agents.filter(
    (agent) => input.history(agent.id) === "none" && input.canStart(agent),
  );
}
