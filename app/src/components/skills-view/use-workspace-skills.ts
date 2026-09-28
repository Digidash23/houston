import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { isStaleRosterReadError } from "../../lib/agent-gone";
import { queryKeys } from "../../lib/query-keys";
import { tauriSkills } from "../../lib/tauri";
import type { Agent, SkillSummary } from "../../lib/types";
import {
  aggregateWorkspaceSkills,
  type WorkspaceSkillRow,
} from "../../lib/workspace-skills";
import { everyReadAnswered } from "./workspace-skill-acts";

/**
 * The skill lists of the agents it is given, aggregated (HOU-792): one
 * employee's for its Skills section, every employee's for the editor menu's
 * acts that reach them all.
 *
 * One query PER agent on the same `queryKeys.skills(path)` keys the per-agent
 * tab uses, so `SkillsChanged` events and the existing mutations refresh this
 * page for free. Fetched once per mount and then event-driven only — in hosted
 * mode each fetch fans out to that agent's pod and resets its idle-sleep
 * clock, so focus/staleness sweeps are disabled exactly like
 * `useAllConversations`.
 */
export function useWorkspaceSkills(agents: Agent[]): {
  rows: WorkspaceSkillRow[];
  /** folderPath → that agent's current list (undefined while loading). */
  listsByPath: Map<string, SkillSummary[] | undefined>;
  loading: boolean;
  /** Every agent's list answered. False after a settled read with no answer
   *  too: a gone or unreadable agent is silenced, never `failed`. */
  complete: boolean;
  /** At least one agent's list did not answer, so what is on screen is not the
   *  workspace. The failure is already toasted and reported by the engine call
   *  itself (`lib/tauri`), so the surface only has to SAY it. */
  failed: boolean;
  /** Read every agent's list again — the user-initiated retry. */
  retry: () => void;
} {
  const { lists, loading, complete, failed, retry } = useQueries({
    queries: agents.map((agent) => ({
      queryKey: queryKeys.skills(agent.folderPath),
      queryFn: () => tauriSkills.list(agent.folderPath),
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
    })),
    combine: (results) => ({
      lists: results.map((r) => r.data),
      loading: results.some((r) => r.isLoading),
      complete: everyReadAnswered(results),
      // A stale roster's gone agent is not a failure: it is silenced at the
      // call and heals itself (HOUSTON-APP-544), and calling it one would put
      // a red screen over a space switch.
      failed: results.some(
        (r) => r.isError && !isStaleRosterReadError(r.error),
      ),
      retry: () => {
        for (const result of results) void result.refetch();
      },
    }),
  });

  const listsByPath = useMemo(
    () =>
      new Map<string, SkillSummary[] | undefined>(
        agents.map((agent, i) => [agent.folderPath, lists[i]]),
      ),
    [agents, lists],
  );

  const rows = useMemo(
    () => aggregateWorkspaceSkills(agents, listsByPath),
    [agents, listsByPath],
  );

  return { rows, listsByPath, loading, complete, failed, retry };
}
