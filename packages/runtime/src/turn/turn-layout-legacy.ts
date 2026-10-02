import { type TurnLayout, TurnSetupError } from "./turn-layout";

/**
 * The flat pre-v0.4 files the host's boot migration still has to carry into
 * their family folders (host/src/migrate/agent-layout.ts), keyed by the
 * family file each lands in.
 */
const LEGACY_LAYOUT: Record<string, string> = {
  ".houston/activity/activity.json": ".houston/activity.json",
  ".houston/routines/routines.json": ".houston/routines.json",
  ".houston/routine_runs/routine_runs.json": ".houston/routine_runs.json",
  ".houston/config/config.json": ".houston/config.json",
  ".houston/learnings/learnings.json": ".houston/memory/learnings.md",
};

/**
 * The flat files in `listed` (store-root-relative keys) whose family file is
 * still missing. The migration copies a flat file only into a MISSING family
 * file, so any write that creates the family file first hides the flat one's
 * data for good.
 */
export function pendingLegacyLayout(
  layout: Pick<TurnLayout, "workspaceRel">,
  listed: Iterable<string>,
): string[] {
  return pendingPairs(layout, listed).map(([, flat]) => flat);
}

/** The family files (relative to the agent) whose flat twin is pending: no
 *  writer but the migration may create them. */
export function pendingLegacyFamilies(
  layout: Pick<TurnLayout, "workspaceRel">,
  listed: Iterable<string>,
): string[] {
  return pendingPairs(layout, listed).map(([family]) => family);
}

function pendingPairs(
  layout: Pick<TurnLayout, "workspaceRel">,
  listed: Iterable<string>,
): [string, string][] {
  const keys = new Set(listed);
  const root = `${layout.workspaceRel}/`;
  return Object.entries(LEGACY_LAYOUT).filter(
    ([family, flat]) => keys.has(root + flat) && !keys.has(root + family),
  );
}

/**
 * Refuse a claimed turn or op over an agent its boot migration has not
 * reached yet: only the `migrate` op may run there (the gateway runs it, then
 * the work).
 */
export function assertMigratedLayout(
  layout: Pick<TurnLayout, "workspaceRel">,
  listed: Iterable<string>,
): void {
  const pending = pendingLegacyLayout(layout, listed);
  if (pending.length === 0) return;
  throw new TurnSetupError(
    "agent_not_migrated",
    `agent store still holds the flat layout (${pending.join(", ")}); its migration must run first`,
  );
}
