import { queryOptions, useQuery } from "@tanstack/react-query";
import type { Config } from "../../data/config";
import { readAgentConfig } from "../../lib/agent-provisioning/born-config";
import { isAgentPathCreating } from "../../lib/agent-warming-guard";
import { queryKeys } from "../../lib/query-keys";
import { tauriConfig } from "../../lib/tauri";

/**
 * The query for an agent's `.houston/config/config.json`: ONE key and ONE
 * reader for every surface that reads it, alone (`useAgentConfig`) or many at
 * once (`useQueries`), so they all share the cache entries the config event
 * invalidation refreshes. A failed read is reported by the engine call itself.
 * A just-created agent keeps the config its create recorded until its engine
 * answers (`lib/agent-provisioning/born-config.ts`).
 */
export function agentConfigQueryOptions(agentPath: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.config(agentPath ?? ""),
    queryFn: ({ client, queryKey }) => {
      if (!agentPath) throw new Error("agentPath required");
      return readAgentConfig({
        creating: isAgentPathCreating(agentPath),
        cached: client.getQueryData<Config>(queryKey),
        read: () => tauriConfig.read(agentPath),
      });
    },
    enabled: !!agentPath,
  });
}

/**
 * The agent's `.houston/config/config.json` (provider/model/effort + extras).
 *
 * Reactive: the file watcher + `ConfigChanged` event invalidate
 * `queryKeys.config(agentPath)`, so a model change elsewhere reflects here
 * without a remount.
 */
export function useAgentConfig(agentPath: string | undefined) {
  return useQuery(agentConfigQueryOptions(agentPath));
}
