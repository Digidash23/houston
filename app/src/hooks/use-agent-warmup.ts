import { useEffect, useReducer } from "react";
import {
  type AgentWarmup,
  SLOW_START_MS,
  warmingEntryFor,
  warmupAt,
} from "../lib/agent-provisioning/warmup";
import { useAgentProvisioningStore } from "../stores/agent-provisioning";

/** The live warm-up of one AI Employee; `ready` when there is none. */
export function useAgentWarmup(agentPath: string | null): AgentWarmup {
  // Primitives, not the entry: the store flips `timedOut` on the same object.
  const since = useAgentProvisioningStore((s) =>
    agentPath === null
      ? null
      : (warmingEntryFor(Object.values(s.provisioning), agentPath)?.since ??
        null),
  );
  const timedOut = useAgentProvisioningStore(
    (s) =>
      agentPath !== null &&
      warmingEntryFor(Object.values(s.provisioning), agentPath)?.timedOut ===
        true,
  );
  // Nothing in the store changes when a start turns slow, so a timer
  // re-renders at that moment.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (since === null || timedOut) return;
    const left = since + SLOW_START_MS - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(rerender, left);
    return () => clearTimeout(timer);
  }, [since, timedOut]);
  return warmupAt(since === null ? undefined : { since, timedOut }, Date.now());
}
