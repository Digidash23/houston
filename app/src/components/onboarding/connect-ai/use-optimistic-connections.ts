import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderConnections } from "../../../hooks/use-provider-connections";
import { logAndReportError } from "../../../lib/error-report";
import type { ProviderInfo } from "../../../lib/providers";
import { optimisticConnectionState } from "./optimistic-connection";

/**
 * The connect card's provider connections, usable before the first probe has
 * answered ({@link optimisticConnectionState}). A Connect pressed while the
 * probe is on its way shows as connecting at once and starts the moment the
 * probe answers: a sign-in sent to an AI home still starting up would fail,
 * so it waits for it instead. Cancel drops a press still waiting. When the
 * probe answers, the cards' own statuses refresh so none stays "checking".
 */
export function useOptimisticConnections(
  connections: ProviderConnections,
  probeSettled: boolean,
): ProviderConnections {
  const [waiting, setWaiting] = useState<ProviderInfo | null>(null);
  const live = useRef(connections);
  live.current = connections;

  useEffect(() => {
    if (!probeSettled) return;
    live.current
      .refresh()
      .catch((error: unknown) =>
        logAndReportError("onboarding_connect_refresh", error),
      );
  }, [probeSettled]);

  useEffect(() => {
    if (!probeSettled || waiting === null) return;
    setWaiting(null);
    // Already connected (it was, before the probe could say): nothing to
    // start, and onboarding moves on by itself.
    if (live.current.connectionState(waiting) !== "connected")
      live.current.connect(waiting);
  }, [probeSettled, waiting]);

  const connectionState = useCallback(
    (provider: ProviderInfo) =>
      optimisticConnectionState(
        connections.connectionState(provider),
        probeSettled,
      ),
    [connections, probeSettled],
  );
  const connect = useCallback(
    (provider: ProviderInfo) => {
      if (probeSettled) connections.connect(provider);
      else setWaiting(provider);
    },
    [connections, probeSettled],
  );
  const cancel = useCallback(
    async (provider: ProviderInfo) => {
      if (waiting?.id === provider.id) setWaiting(null);
      else await connections.cancel(provider);
    },
    [connections, waiting],
  );

  return useMemo(
    () => ({
      ...connections,
      connectionState,
      connect,
      cancel,
      busy: waiting
        ? { ...connections.busy, [waiting.id]: "connecting" as const }
        : connections.busy,
    }),
    [connections, connectionState, connect, cancel, waiting],
  );
}
