import type { SkillSummary } from "../../lib/types";

/**
 * How the workspace's skill rows narrow to ONE employee's Skills section, kept
 * pure so it is node-testable and the components stay renderers. The rows
 * arrive for the whole workspace; the section shows what this employee has,
 * pointed at the copy it runs.
 */

/** The slice of a list row these rules read: who the skill is live on. */
interface ScopedSkillRow {
  agents: readonly { id: string }[];
}

/**
 * Narrow rows to one agent. The workspace-shared store lists every skill it
 * holds whether or not an agent loads it, so an agent's own section would
 * otherwise offer skills that agent does not have.
 */
export function scopeSkillRows<T extends ScopedSkillRow>(
  rows: readonly T[],
  agentId: string,
): T[] {
  return rows.filter((row) => row.agents.some((a) => a.id === agentId));
}

/** The slice of a list row the override resolution rewrites. */
interface OverridableSkillRow {
  slug: string;
  summary: SkillSummary;
  /** Where the canonical copy lives; absent where there is no store. */
  origin?: "shared" | "local";
  agents: readonly { id: string }[];
  /** Agents whose own copy shadows the store version. */
  overriddenBy?: readonly { id: string }[];
}

/**
 * Point an employee's rows at the copy that employee actually RUNS.
 *
 * A local copy of a store slug shadows the store version, so the workspace
 * aggregate folds it into the shared row as an override. Read through that row
 * the employee's own section would load, save and disable the STORE copy — a
 * save there rewrites the skill for every other employee while this one keeps
 * its untouched copy. Scoped to the employee, such a row becomes its local copy
 * instead, keeping the override mark so the editor can still offer the
 * workspace version.
 *
 * Until the employee's own list has landed there is nothing to resolve TO, and
 * a row rewritten to "local" while still carrying the store's title would
 * rename itself on screen the moment the list arrives. So an unread list
 * (`undefined`) leaves every row exactly as the aggregate resolved it; an
 * empty map is the answer "this employee has no copies", which is different.
 *
 * A row the two reads disagree about — the aggregate names this employee as an
 * overrider, the read list holds no such copy — is HELD BACK until they agree.
 * Listed as the store row it would open the store copy, where the editor says
 * "This is the workspace version" and a save rewrites the skill for every
 * employee while this one goes on running the copy it kept. The disagreement
 * is one read behind the other, and both refresh together.
 */
export function resolveScopedOverrides<T extends OverridableSkillRow>(
  rows: readonly T[],
  agentId: string,
  /** slug → the employee's own copy, or undefined while its list is loading. */
  localsBySlug: ReadonlyMap<string, SkillSummary> | undefined,
): T[] {
  if (localsBySlug === undefined) return [...rows];
  const resolved: T[] = [];
  for (const row of rows) {
    const mine = (row.overriddenBy ?? []).filter((a) => a.id === agentId);
    if (row.origin !== "shared" || mine.length === 0) {
      resolved.push(row);
      continue;
    }
    const local = localsBySlug.get(row.slug);
    if (local === undefined) continue;
    resolved.push({
      ...row,
      origin: "local" as const,
      summary: local,
      agents: row.agents.filter((a) => a.id === agentId),
      overriddenBy: mine,
    });
  }
  return resolved;
}
