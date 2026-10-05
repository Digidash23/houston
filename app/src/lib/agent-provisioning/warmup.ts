import type { ProvisioningEntry } from "./entry.ts";

/**
 * Where one AI Employee's engine stands: `ready` answers requests, `warming`
 * is still starting (a fresh hire, or a hosted pod waking), `stalled` is
 * still starting past its normal window.
 */
export type AgentWarmup = "ready" | "warming" | "stalled";

/**
 * How long a start may take before the screen stops promising "a few
 * seconds": the prod p90 from create to the engine answering (5.5 s, gateway
 * "agent provisioning" logs, 2026-10-01..02) plus a 3 s margin. Retune it
 * from the same logs when start times move.
 */
export const SLOW_START_MS = 5_500 + 3_000;

/** The warming entry of the AI Employee at `agentPath`, if it has one. */
export function warmingEntryFor(
  entries: Iterable<ProvisioningEntry>,
  agentPath: string,
): ProvisioningEntry | undefined {
  for (const entry of entries) {
    if (entry.agentPath === agentPath) return entry;
  }
  return undefined;
}

/**
 * The warm-up of one entry at `now`. A timed-out entry keeps `stalled` even
 * though its `since` is re-anchored on every TTL lap.
 */
export function warmupAt(
  entry: Pick<ProvisioningEntry, "since" | "timedOut"> | undefined,
  now: number,
): AgentWarmup {
  if (!entry) return "ready";
  if (entry.timedOut || now - entry.since >= SLOW_START_MS) return "stalled";
  return "warming";
}

/** The warm-up of the AI Employee at `agentPath`, from the warming entries. */
export function agentWarmup(
  entries: Iterable<ProvisioningEntry>,
  agentPath: string,
  now: number,
): AgentWarmup {
  return warmupAt(warmingEntryFor(entries, agentPath), now);
}
