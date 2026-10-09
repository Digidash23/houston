import {
  type AgentPaint,
  type AgentPaintHold,
  overlayAgentRoster,
} from "../lib/agent-roster-overlay";
import type { Agent } from "../lib/types";

/**
 * The agent edits still in flight. Every roster that reaches the store (a
 * user write's own paint, a reload an `AgentsChanged` event started) goes
 * through {@link overlayHeldAgentWrites}, so a reload that read the host
 * before it applied the write cannot resurrect a deleted agent or repaint
 * its old name. Module state, like `pendingWorkspaceDeletes`: the roster
 * store is a singleton.
 */
const deletes = new Set<string>();
const paints = new Set<AgentPaintHold>();

export function holdAgentDelete(id: string): () => void {
  deletes.add(id);
  return () => {
    deletes.delete(id);
  };
}

/** Hold `paint` over `id` until the returned release. Releasing never
 *  reverts the row: a refused write restores its own field explicitly. */
export function holdAgentPaint(id: string, paint: AgentPaint): () => void {
  const hold: AgentPaintHold = { id, paint };
  paints.add(hold);
  return () => {
    paints.delete(hold);
  };
}

/** A rename moved the agent's folder-derived id: its other holds follow. */
export function carryAgentPaints(fromId: string, toId: string): void {
  for (const hold of paints) if (hold.id === fromId) hold.id = toId;
}

export function overlayHeldAgentWrites(agents: Agent[]): Agent[] {
  return overlayAgentRoster(agents, { deletes, paints });
}

/** An identity change drops the outgoing account's holds with its roster. */
export function clearAgentHolds(): void {
  deletes.clear();
  paints.clear();
}
