import type { Agent } from "./types";

/** The fields an optimistic agent edit paints before the host answers. */
export interface AgentPaint {
  name?: string;
  color?: string;
}

/** One edit still in flight. `id` moves with a rename (`carryAgentPaints`). */
export interface AgentPaintHold {
  id: string;
  paint: AgentPaint;
}

export interface AgentRosterHolds {
  deletes: ReadonlySet<string>;
  paints: Iterable<AgentPaintHold>;
}

/** `agent` with `paint` applied; the same object when nothing changes. */
export function paintAgentRow(agent: Agent, paint: AgentPaint): Agent {
  const nameChanges = paint.name !== undefined && paint.name !== agent.name;
  const colorChanges = paint.color !== undefined && paint.color !== agent.color;
  if (!nameChanges && !colorChanges) return agent;
  return {
    ...agent,
    ...(nameChanges ? { name: paint.name } : {}),
    ...(colorChanges ? { color: paint.color } : {}),
  };
}

/**
 * A roster as the person should see it while writes are in flight: deleted
 * agents gone, renames and recolors painted. A roster read that lands
 * mid-write carries the host's pre-write truth, so it is passed through here
 * before it reaches the store. The same array when nothing is held.
 */
export function overlayAgentRoster(
  agents: Agent[],
  holds: AgentRosterHolds,
): Agent[] {
  let changed = false;
  const next: Agent[] = [];
  for (const agent of agents) {
    if (holds.deletes.has(agent.id)) {
      changed = true;
      continue;
    }
    let painted = agent;
    for (const hold of holds.paints) {
      if (hold.id === agent.id) painted = paintAgentRow(painted, hold.paint);
    }
    if (painted !== agent) changed = true;
    next.push(painted);
  }
  return changed ? next : agents;
}

/** Put a refused delete's row back where it was, unless a reload already did. */
export function restoreAgentRow(
  agents: Agent[],
  row: Agent,
  index: number,
): Agent[] {
  if (agents.some((a) => a.id === row.id)) return agents;
  const at = Math.min(Math.max(index, 0), agents.length);
  return [...agents.slice(0, at), row, ...agents.slice(at)];
}

/**
 * The selection after a refused delete of the agent being viewed. The delete
 * moved the view to `switchedTo`; if the person is still there, the view goes
 * back to `row`. Null when they moved on since: their own pick stands.
 */
export function selectionAfterRefusedDelete(
  current: Agent | null,
  switchedTo: Agent | null,
  row: Agent,
): Agent | null {
  if ((current?.id ?? null) !== (switchedTo?.id ?? null)) return null;
  return current?.id === row.id ? null : row;
}
