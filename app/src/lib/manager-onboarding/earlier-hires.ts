/**
 * Who existed when the team step opened, fixed once: an interrupted first run
 * hired them, so they are on the team already. Only the ids are kept.
 */
export function earlierHireIds(
  agents: readonly { id: string }[],
): ReadonlySet<string> {
  return new Set(agents.map((agent) => agent.id));
}

/**
 * The earlier hires, read from the LIVE agent list, so a rename or a removal
 * since shows as it is, and this run's own hires (absent from `ids`) are never
 * listed twice. Nothing while `ids` is not taken yet.
 */
export function earlierHires<A extends { id: string }>(
  agents: readonly A[],
  ids: ReadonlySet<string> | null,
): A[] {
  if (ids === null) return [];
  return agents.filter((agent) => ids.has(agent.id));
}
