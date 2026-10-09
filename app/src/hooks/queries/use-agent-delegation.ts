import type { AgentDelegation } from "@houston/protocol";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { tauriAgentDelegation } from "../../lib/delegation-facade";
import { reportError } from "../../lib/error-report";
import { tellOptimisticRefusal } from "../../lib/optimistic-write";
import { queryKeys } from "../../lib/query-keys";

interface DelegationWriteState {
  confirmed: AgentDelegation;
  latest: number;
  pending: number;
}

const writeStates = new WeakMap<
  QueryClient,
  Map<string, DelegationWriteState>
>();

function statesFor(qc: QueryClient): Map<string, DelegationWriteState> {
  let states = writeStates.get(qc);
  if (!states) {
    states = new Map();
    writeStates.set(qc, states);
  }
  return states;
}

export function useAgentDelegation(agentId: string, enabled: boolean) {
  const qc = useQueryClient();
  const key = queryKeys.agentDelegation(agentId);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const pendingAtStart = (statesFor(qc).get(agentId)?.pending ?? 0) > 0;
      try {
        const stored = await tauriAgentDelegation.get(agentId);
        // AgentsChanged can refetch between queued PUTs; that GET cannot become
        // the base of the next optimistic pick while any write remains pending.
        if (pendingAtStart || (statesFor(qc).get(agentId)?.pending ?? 0) > 0) {
          return qc.getQueryData<AgentDelegation>(key) ?? stored;
        }
        return stored;
      } catch (error) {
        reportError("get_agent_delegation", String(error), error);
        throw error;
      }
    },
    enabled,
  });
}

export function useSetAgentDelegation(agentId: string) {
  const qc = useQueryClient();
  const { t } = useTranslation("teams");
  const key = queryKeys.agentDelegation(agentId);
  const states = statesFor(qc);
  const mutation = useMutation({
    mutationKey: key,
    scope: { id: `agent-delegation:${agentId}` },
    mutationFn: ({ policy }: { policy: AgentDelegation; id: number }) =>
      tauriAgentDelegation.set(agentId, policy),
    onSuccess: (stored, { id }) => {
      const state = states.get(agentId);
      if (!state) return;
      state.confirmed = stored;
      if (state.latest === id) qc.setQueryData(key, stored);
    },
    onError: (error, { id }) => {
      const state = states.get(agentId);
      // Each PUT carries the whole policy, so a later pick that lands carries
      // this one too: only a refused LATEST pick is visibly undone and told.
      if (state?.latest !== id) {
        reportError("set_agent_delegation", String(error), error);
        return;
      }
      qc.setQueryData(key, state.confirmed);
      tellOptimisticRefusal("set_agent_delegation", error, {
        title: t("writeFailed.delegation.title"),
        description: t("writeFailed.delegation.description"),
      });
    },
    onSettled: () => {
      const state = states.get(agentId);
      if (!state) return;
      state.pending -= 1;
      if (state.pending === 0) return qc.invalidateQueries({ queryKey: key });
    },
  });
  const mutate = (change: (current: AgentDelegation) => AgentDelegation) => {
    const current = qc.getQueryData<AgentDelegation>(key);
    if (!current) {
      reportError("set_agent_delegation", "Delegation policy is not loaded");
      return;
    }
    let state = states.get(agentId);
    if (!state) {
      state = { confirmed: current, latest: 0, pending: 0 };
      states.set(agentId, state);
    }
    if (state.pending === 0) state.confirmed = current;
    const policy = change(current);
    const id = ++state.latest;
    state.pending += 1;
    qc.cancelQueries({ queryKey: key }).catch((error: unknown) => {
      reportError("cancel_agent_delegation_query", String(error), error);
    });
    qc.setQueryData(key, policy);
    mutation.mutate({ policy, id });
  };
  return { ...mutation, mutate };
}
