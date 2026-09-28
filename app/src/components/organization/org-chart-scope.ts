import type { Agent, OrgRole } from "@houston/engine-adapter";
import type { OrgChartUsage, OrgChartWork } from "./org-chart-model.ts";
import type { LedgerLine, OrgChartRead } from "./org-chart-view-model.ts";

/**
 * Whose chart this is. Pure and DOM-free.
 *
 * `org`: an owner, who is served every agent, every message and the whole
 * roster, so the chart is the organization's. `yours`: anyone else. They are
 * served only their own agents, and the gateway counts messages only on the
 * agents they manage, so the chart is scoped to their AI Employees and says
 * so. `personal`: a personal space, which is one person.
 */
export type OrgChartScope = "org" | "yours" | "personal";

export function orgChartScope(input: {
  role: OrgRole;
  personal: boolean;
}): OrgChartScope {
  if (input.personal) return "personal";
  return input.role === "owner" ? "org" : "yours";
}

/** Whether the gateway counts this agent's messages for this caller. */
export function messagesCounted(
  agent: Pick<Agent, "access">,
  scope: OrgChartScope,
): boolean {
  return scope !== "yours" || agent.access === "manager";
}

/** The chart's counts and the window's totals the hero reads out. */
export interface HeroFigures {
  scope: OrgChartScope;
  agents: number;
  /** The organization's people, `null` where the chart is not the org's. */
  people: number | null;
  /** `null` when time worked is not readable. */
  workMs: number | null;
  /** `null` when no line has a readable message count. */
  messages: number | null;
  /** The message figure covers managed lines only. */
  messagesScoped: boolean;
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

/**
 * The hero's figures, summed over the ledger's own lines so every total
 * covers the same AI Employees the ledger ranks. Partial message counts are
 * marked so the copy names their managed scope.
 */
export function heroFigures(input: {
  scope: OrgChartScope;
  lines: readonly LedgerLine[];
  /** The roster's size. */
  people: number;
  work: OrgChartWork | null;
  usage: OrgChartUsage | null;
}): HeroFigures {
  const { scope, lines } = input;
  const counted = lines.flatMap((line) =>
    line.messages === null ? [] : [line.messages],
  );
  return {
    scope,
    agents: lines.length,
    people: scope === "org" ? input.people : null,
    workMs: input.work ? sum(lines.map((line) => line.workMs)) : null,
    messages: input.usage && counted.length > 0 ? sum(counted) : null,
    messagesScoped: counted.length < lines.length,
  };
}

/**
 * The messages read as the hero sees it: a read that landed without a
 * counted total leads nothing.
 */
export function heroMessagesRead(
  read: OrgChartRead,
  total: number | null,
): OrgChartRead {
  return read === "ready" && total === null ? "hidden" : read;
}
