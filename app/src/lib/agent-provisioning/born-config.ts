/**
 * The config a new agent was created with, held in the config query cache
 * from the moment the create answers.
 *
 * A just-created hosted agent's reads answer an empty placeholder until its
 * engine first answers (`warmingReadsAnswerEmpty`): seconds normally, minutes
 * during an engine rollout. Read alone, its config says nothing for that long,
 * and the first-day offer it carries would wait on the warm-up. But the create
 * itself wrote that config (`AgentInitialConfig` rides the create as its
 * config document), so the app seeds the cache with exactly what it sent and
 * a new hire's start button is there at once.
 *
 * While the placeholder stands, the config read answers what the cache holds
 * instead of the placeholder ({@link readAgentConfig}), so a config event or a
 * focus refetch mid-warm-up never swaps the seed for an empty config. The
 * warm-up handoff opens the reads and refetches the real document.
 *
 * Kept free of the engine client so `node --test` loads it directly.
 */

import type { AgentInitialConfig } from "@houston/engine-adapter";
import type { QueryClient } from "@tanstack/react-query";
import type { Config } from "../../data/config.ts";
import { toCanonicalProviderId } from "../provider-overrides/dialect.ts";
import { queryKeys } from "../query-keys.ts";

/**
 * The config document fields a create records, as the host stores them: the
 * provider in pi's canonical dialect, and only the fields the create named. A
 * first day is pending only when the create said so.
 */
export function bornConfig(initial: AgentInitialConfig): Config {
  return {
    ...(initial.provider
      ? { provider: toCanonicalProviderId(initial.provider) }
      : {}),
    ...(initial.model ? { model: initial.model } : {}),
    ...(initial.firstDay ? { firstDay: initial.firstDay } : {}),
    ...(initial.arrival ? { arrival: initial.arrival } : {}),
  };
}

/**
 * Seed a created agent's config cache with what its create recorded. Seeded
 * stale: the first read that CAN reach the document (at once on a co-located
 * engine, after the handoff on a hosted one) still replaces it, since a
 * template may seed config fields of its own that the create did not name.
 */
export function seedBornConfig(
  client: QueryClient,
  agentPath: string,
  initial: AgentInitialConfig | undefined,
): void {
  if (!initial) return;
  const born = bornConfig(initial);
  if (Object.keys(born).length === 0) return;
  client.setQueryData<Config>(
    queryKeys.config(agentPath),
    (prev) => ({ ...prev, ...born }),
    { updatedAt: 0 },
  );
}

/**
 * What the host recorded once a first day started, so every start button goes
 * on the same frame instead of after the config refetch.
 */
export function recordFirstDayStarted(
  client: QueryClient,
  agentPath: string,
): void {
  client.setQueryData<Config>(queryKeys.config(agentPath), (prev) => ({
    ...prev,
    firstDay: "started",
  }));
}

/**
 * The config query's read. While the agent's reads answer the creating
 * placeholder, it answers what the cache already holds (the create's seed, or
 * a start recorded since) rather than the placeholder's empty config.
 */
export function readAgentConfig(deps: {
  /** The agent's reads answer the placeholder (`isAgentPathCreating`). */
  creating: boolean;
  cached: Config | undefined;
  read: () => Promise<Config>;
}): Promise<Config> {
  return deps.creating ? Promise.resolve(deps.cached ?? {}) : deps.read();
}
