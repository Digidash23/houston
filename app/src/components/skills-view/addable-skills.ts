/**
 * What "Add an existing skill" can offer one AI Employee, kept pure so the
 * decision is node-testable and the dialog stays a renderer.
 *
 * A workspace skill lives ONCE in the shared store (ADR 0003) and an employee
 * LOADS it through its manifest, so adding one is a manifest write and never a
 * copy. That is the only reach the client has: a skill that lives on another
 * employee as its own copy has no move of its own behind it, so it is not
 * offered here rather than being re-implemented as a read-then-write in the
 * surface.
 */

/**
 * Whether "Add an existing skill" is offered at all.
 *
 * The add writes the employee's manifest against the workspace store, so a
 * deployment that serves no store has nothing the act could reach: the menu
 * item there would open a dialog that stays empty forever.
 */
export function offersAddExisting(input: {
  /** `capabilities.sharedSkills` — false on every cloud profile. */
  sharedStore: boolean;
}): boolean {
  return input.sharedStore;
}

/** The slice of a Skills list row these rules read. */
interface AddableCandidate {
  /** Where the canonical copy lives; absent on deployments with no store. */
  origin?: "shared" | "local";
  /** The employees the row is live on. */
  agents: readonly { id: string }[];
}

/**
 * The store skills this employee does not load yet, in the caller's order.
 *
 * Rows arrive scoped to the whole workspace, so a row the employee already has
 * carries it among its agents; those are what the list drops.
 */
export function addableSkills<T extends AddableCandidate>(
  rows: readonly T[],
  agentId: string,
): T[] {
  return rows.filter(
    (row) =>
      row.origin === "shared" && !row.agents.some((a) => a.id === agentId),
  );
}
