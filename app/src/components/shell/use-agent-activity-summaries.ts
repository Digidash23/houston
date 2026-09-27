import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { Activity } from "../../data/activity";
import { useAllConversations } from "../../hooks/queries";
import { sliceCoverage } from "../../lib/all-conversations-coverage";
import { queryKeys } from "../../lib/query-keys";
import type { Agent } from "../../lib/types";
import {
  buildAgentActivitySummaries,
  summarizeActivities,
} from "./agent-activity-summary-model";

export function useAgentActivitySummaries(
  agents: Pick<Agent, "id" | "folderPath">[],
) {
  const agentPaths = useMemo(
    () => agents.map((agent) => agent.folderPath),
    [agents],
  );
  const aggregate = useAllConversations(agentPaths);
  const conversations = aggregate.data;
  // Placeholder = a disk-restored older roster variant (or the previous key's
  // data), not a fetch for THIS roster — good enough to paint, but each
  // agent's own restored board query is at least as fresh, so it wins below.
  const aggregateIsAuthoritative =
    conversations !== undefined && !aggregate.isPlaceholderData;

  // Re-render when any agent's own board query (`["activity", path]`) changes
  // in the cache, WITHOUT attaching query observers: a per-render useQueries
  // subscription here re-synced its observers on every sidebar render and the
  // resulting notification churn kept the whole shell re-rendering (the
  // auto-opened chat panel could no longer be Escape-closed — caught by the
  // web e2e suite). A raw QueryCache subscription has no options to re-sync,
  // and it can never trigger a fetch, so it also can't wake a pod.
  const queryClient = useQueryClient();
  const activityCacheVersion = useRef(0);
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] !== "activity") return;
        // Only data changes. The cache also emits synchronously from INSIDE a
        // mounting component's render (v5 builds the query there, emitting
        // "added"/"observerAdded"), and re-rendering the sidebar from that
        // listener is a setState-in-render violation. "updated" (fetch landed,
        // setQueryData — including the one that creates a key) and "removed"
        // (eviction) are dispatched outside render and are the only events
        // that change the rows this hook summarizes.
        if (event.type !== "updated" && event.type !== "removed") return;
        activityCacheVersion.current += 1;
        onStoreChange();
      }),
    [queryClient],
  );
  const cacheVersion = useSyncExternalStore(subscribe, () => {
    return activityCacheVersion.current;
  });
  // A read can confirm an agent has no tasks without changing any row (it had
  // none before too), so the coverage ledger is watched on its own: that
  // confirmation is what turns an `unknown` history into `none`.
  const coverageVersion = useRef(0);
  const subscribeCoverage = useCallback(
    (onStoreChange: () => void) =>
      sliceCoverage.subscribe(() => {
        coverageVersion.current += 1;
        onStoreChange();
      }),
    [],
  );
  const coverageStamp = useSyncExternalStore(
    subscribeCoverage,
    () => coverageVersion.current,
  );

  return useMemo(() => {
    // The version stamp is not read below — it is a dependency so the memo
    // recomputes when a board query lands/updates in the cache.
    void cacheVersion;
    void coverageStamp;
    // "No tasks" is only an answer from rows that hold the read: a slice can be
    // noted as read (a push patch, or the sweep itself) before the aggregate
    // these rows come from carries it, and an empty slice in a restored or
    // missing aggregate would read as a brand-new employee.
    const summaries = buildAgentActivitySummaries(
      agents,
      conversations ?? [],
      aggregateIsAuthoritative ? sliceCoverage.wasRead : () => false,
    );
    if (!aggregateIsAuthoritative) {
      // While the aggregate has not fetched for the current roster key (cold
      // boot, pods still waking), an agent with restored/live board data gets
      // its badge from the SAME rows the board and the "Activity N" tab
      // render — cache reads only, never a fetch. Never a confirmed "no
      // tasks": these caches can be restored from disk, and a push notes a
      // slice read without patching them.
      for (const agent of agents) {
        const activities = queryClient.getQueryData<Activity[]>(
          queryKeys.activity(agent.folderPath),
        );
        if (!activities) continue;
        summaries[agent.id] = summarizeActivities(activities, false);
      }
    }
    return summaries;
  }, [
    agents,
    conversations,
    aggregateIsAuthoritative,
    queryClient,
    cacheVersion,
    coverageStamp,
  ]);
}
