import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { isAssistantUnavailableError } from "../lib/assistant-availability.ts";
import { runDiscoveryLadder } from "../lib/assistant-discovery-ladder.ts";
import {
  type AssistantDiscovery,
  assistantDiscoveryState,
} from "../lib/assistant-discovery-state.ts";
import { assistantRefetchIntervalMs } from "../lib/assistant-retry-schedule.ts";
import { newEngineActive } from "../lib/engine.ts";
import { queryKeys } from "../lib/query-keys.ts";
import {
  type AssistantHandle,
  surfaceEngineError,
  tauriAssistant,
} from "../lib/tauri.ts";
import { useWorkspaceStore } from "../stores/workspaces.ts";

export type {
  AssistantDiscovery,
  AssistantFailure,
} from "../lib/assistant-discovery-state.ts";

/** Discovery's answer, plus the one thing a screen can DO about a bad one. */
export interface AssistantAccess extends AssistantDiscovery {
  /**
   * Ask again now. Resolves when the attempt (ladder and all) settles, so a
   * button can await it and show the wait instead of looking inert. The 60s
   * background beat keeps running either way — this only shortens the wait to
   * the next ask, it never replaces it.
   */
  retry: () => Promise<void>;
}

/**
 * Ask for the assistant's address, retrying on the budget the failure earns.
 *
 * The ladder lives HERE and not in the query's `retry` option because `call()`
 * in lib/tauri.ts logs, toasts and Sentry-captures every rejection it sees: a
 * query-level retry turned ONE waking pod into a stack of toasts and a Sentry
 * event per attempt. Every attempt runs silent (`surface: false` — still
 * logged) and the FINAL error is surfaced once, by hand, down the same path
 * `call()` would have used. Same discipline as the cross-agent sweep
 * (`hooks/queries/all-conversations-sweep.ts`).
 */
export function discoverAssistant(
  signal?: AbortSignal,
): Promise<AssistantHandle> {
  return runDiscoveryLadder({
    ask: () => tauriAssistant.discover({ surface: false }),
    // The same silence the single-call path used: a deployment with no
    // assistant and a pod that is merely waking are both expected states of
    // a healthy install, so they are logged and never reported.
    surface: (err) =>
      surfaceEngineError("get_assistant", err, undefined, {
        silence: isAssistantUnavailableError,
      }),
    signal,
  });
}

/**
 * The one definition of the discovery query for a space, shared by the hook
 * and the channel-link landing so both read and fill the same entry.
 *
 * The address is fixed for a person in a space, so a settled answer is kept
 * for the whole session: never stale, never collected, held across a space
 * switch and out of the reconnect sweep (`lib/assistant-address-cache.ts`).
 * Each ask holds the gateway until the assistant's pod is awake, so a
 * needless one wakes it. Only an identity change or the space leaving the
 * list drops the entry.
 */
export function assistantQueryOptions(spaceId: string | null) {
  return {
    queryKey: queryKeys.assistant(spaceId),
    queryFn: ({ signal }: { signal: AbortSignal }) => discoverAssistant(signal),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  };
}

/**
 * Discover the user's personal assistant.
 *
 * The assistant is an ordinary agent conversation, so this address is the ONLY
 * thing the app cannot work out for itself; every call the chat then makes is
 * the existing per-agent surface. Discovery is lazy on the host (it materializes
 * the hidden agent on first ask) and idempotent, so asking once at boot is both
 * cheap and what makes the rail row honest.
 *
 * Three answers, read by `classifyAssistantDiscoveryFailure`:
 *
 *  - **No assistant here** — a deployment whose host does not implement
 *    discovery (a gateway fronts it, or it holds no agent tree), a gateway that
 *    predates the route, or one with no assistant credential bound. That is
 *    feature ABSENCE: it settles hidden and is never asked again.
 *  - **Not yet** — the gateway's answer while an engine pod provisions, wakes
 *    or is replaced. Recoverable, so it is retried with backoff (honouring a
 *    retry hint the failure advertises) and, once the budget is spent, polled
 *    on a slow beat while the screen says so and offers `retry`.
 *  - **Anything else** — a real failure, kept on the loud path (the log and
 *    Sentry get it) with one blind retry so a gateway handoff does not cost a
 *    session's assistant. The user is told the same honest thing as above and
 *    never sees the failure's shape.
 *
 * Neither of the last two takes the assistant off the screen: a deployment
 * that HAS an assistant and cannot start it must stay somewhere the user can
 * ask again, not vanish until the next app launch (PRODUCT-1795).
 *
 * `staleTime` is infinite for the SUCCESS case only: an address does not
 * change under us. A query holding no data is stale whatever that value says,
 * which is exactly what makes an unanswered discovery keep trying. The answer
 * is kept per space for the session (see {@link assistantQueryOptions}).
 */
export function useAssistant(): AssistantAccess {
  const enabled = newEngineActive();
  const spaceId = useWorkspaceStore((s) => s.current?.id ?? null);
  const query = useQuery({
    ...assistantQueryOptions(spaceId),
    enabled,
    // No `retry` here on purpose: the bounded, reason-aware ladder is inside
    // `discoverAssistant`, where the intermediate attempts stay silent.
    retry: false,
    // A spent ladder on a still-waking pod is not a settled answer, so the
    // query keeps asking on a slow beat rather than leaving the rail row
    // absent until something else happens to remount it. Absence ("this
    // deployment has no assistant") and real failures poll nothing: one is
    // final, the other is already reported.
    refetchInterval: (q) => assistantRefetchIntervalMs(q.state.error),
  });

  // `refetch` on a query already in its error state keeps that error until the
  // new attempt settles, so the screen holds its honest state (with a pending
  // button) rather than blinking back to the starting spinner on every ask.
  const { refetch } = query;
  const retry = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    ...assistantDiscoveryState({
      enabled,
      handle: query.data ?? null,
      error: query.error,
    }),
    retry,
  };
}
