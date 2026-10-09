/**
 * Feeds the live signals to the ONE connect-AI decision
 * (`lib/connect-ai-gate.ts`), for the chat composer and the first-day start
 * button and banner alike, and supplies the connect target, the AI Hub.
 *
 * Reactivity is free: the provider-status query is invalidated on
 * `ProviderLoginComplete`, so connecting an AI flips the gate back with no
 * manual wiring.
 */

import { useCallback } from "react";
import {
  type ConnectAiGateState,
  connectAiGateState,
} from "../lib/connect-ai-gate.ts";
import type { ProviderConnectionStatus } from "../lib/provider-connection.ts";
import { isTeamWorkspace } from "../lib/space-id.ts";
import { AI_HUB_VIEW_ID } from "../lib/top-level-views.ts";
import { useUIStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspaces";
import { useCapabilities } from "./use-capabilities";
import { useProviderCatalog } from "./use-provider-catalog";
import { useProviderStatuses } from "./use-provider-statuses";

export interface ConnectAiGate extends ConnectAiGateState {
  /** Opens the AI Hub. */
  connect: () => void;
}

/** A provider scan as `useProviderStatuses` returns it. */
export interface ConnectAiScan {
  statuses: Record<string, ProviderConnectionStatus>;
  isLoading: boolean;
  isError: boolean;
}

/** The gate over a scan the caller already holds (the chat panel's). */
export function useConnectAiDecision(scan: ConnectAiScan): ConnectAiGate {
  const { capabilities, isLoading: capabilitiesLoading } = useCapabilities();
  const { isReady: catalogReady } = useProviderCatalog();
  const workspaceId = useWorkspaceStore((s) => s.current?.id ?? null);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const state = connectAiGateState({
    statuses: scan.statuses,
    statusesLoading: scan.isLoading,
    statusesError: scan.isError,
    catalogReady,
    capabilities,
    capabilitiesLoaded: !capabilitiesLoading,
    teamSpace: workspaceId ? isTeamWorkspace(workspaceId) : false,
  });
  const connect = useCallback(() => setViewMode(AI_HUB_VIEW_ID), [setViewMode]);
  return { ...state, connect };
}

/** The gate off the shared provider-status query, for a standalone surface. */
export function useConnectAiGate(): ConnectAiGate {
  return useConnectAiDecision(useProviderStatuses());
}
