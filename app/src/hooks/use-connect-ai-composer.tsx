/**
 * Wires the connect-AI composer replacement: the shared gate
 * (`useConnectAiDecision`, the same one the first-day start button reads)
 * decides, and this returns the node the chat panel hands to
 * `composerOverride` in `replace` mode.
 *
 * The connection counts come in as PROPS rather than being re-derived here: the
 * chat panel already computes them from the ONE shared derivation
 * (`providerIsConnected` / `providerConnectionState`), and a second derivation
 * is exactly how two surfaces drift apart about whether a provider is connected.
 *
 * Reactivity is free: `useProviderStatuses` (whose settled counts feed this) is
 * a TanStack query invalidated on `ProviderLoginComplete`, so connecting a
 * provider re-probes, the count goes above zero, and the composer returns with
 * no manual wiring.
 */

import { type ReactNode, useMemo } from "react";
import { ChatConnectAiEmptyState } from "../components/chat-connect-ai-empty-state.tsx";
import {
  type ConnectAiScanSignals,
  useConnectAiDecision,
} from "./use-connect-ai-gate";

export interface ConnectAiComposer {
  /** True while the empty state stands in for the composer. */
  active: boolean;
  /** The replacement node, or null when the normal composer stands. */
  node: ReactNode | null;
}

export function useConnectAiComposer(
  opts: ConnectAiScanSignals,
): ConnectAiComposer {
  const { active, variant, canConnect, connect } = useConnectAiDecision(opts);
  const node = useMemo<ReactNode | null>(
    () =>
      active ? (
        <ChatConnectAiEmptyState
          variant={variant}
          onConnect={canConnect ? connect : undefined}
        />
      ) : null,
    [active, variant, canConnect, connect],
  );
  return { active, node };
}
