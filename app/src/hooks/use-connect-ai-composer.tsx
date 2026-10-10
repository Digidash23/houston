/**
 * Wires the connect-AI composer replacement: the shared gate
 * (`useConnectAiDecision`, the same one the first-day start button reads)
 * decides, and this returns the node the chat panel hands to
 * `composerOverride` in `replace` mode.
 *
 * The scan comes in as a PROP: the chat panel already holds it, and the gate
 * counts it through the ONE shared derivation (`providerConnectionCounts`), the
 * same the first-day start button reads.
 *
 * Reactivity is free: `useProviderStatuses` (whose settled counts feed this) is
 * a TanStack query invalidated on `ProviderLoginComplete`, so connecting a
 * provider re-probes, the count goes above zero, and the composer returns with
 * no manual wiring.
 */

import { type ReactNode, useMemo } from "react";
import { ChatConnectAiEmptyState } from "../components/chat-connect-ai-empty-state.tsx";
import {
  type ConnectAiScan,
  useConnectAiDecision,
} from "./use-connect-ai-gate";

export interface ConnectAiComposer {
  /** True while the empty state stands in for the composer. */
  active: boolean;
  /** The replacement node, or null when the normal composer stands. */
  node: ReactNode | null;
}

export function useConnectAiComposer(scan: ConnectAiScan): ConnectAiComposer {
  const { active, variant, canConnect, connect } = useConnectAiDecision(scan);
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
