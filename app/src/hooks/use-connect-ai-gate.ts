/**
 * "Is there no AI connected, and can this viewer go connect one?" as ONE
 * decision, for every surface that would otherwise start a turn no provider
 * can answer: the chat composer (`use-connect-ai-composer.tsx`) and the
 * first-day start button. Both read the same rule
 * (`shouldReplaceComposerWithConnectAi`, conservative: anything uncertain
 * keeps the normal action) and the same connect target, the AI Hub.
 *
 * Reactivity is free: the provider-status query is invalidated on
 * `ProviderLoginComplete`, so connecting an AI flips the gate back with no
 * manual wiring.
 */

import { useCallback, useMemo } from "react";
import {
  type PickerEmptyState,
  pickerEmptyState,
} from "../components/chat-model-selector-labels.ts";
import {
  type ConnectAiComposerSignals,
  providerConnectionCounts,
  shouldReplaceComposerWithConnectAi,
} from "../lib/composer-connect-ai.ts";
import { isTeamWorkspace } from "../lib/space-id.ts";
import { AI_HUB_VIEW_ID } from "../lib/top-level-views.ts";
import { useUIStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspaces";
import { useCapabilities } from "./use-capabilities";
import { useProviderCatalog } from "./use-provider-catalog";
import { useProviderStatuses } from "./use-provider-statuses";

export interface ConnectAiGate {
  /** True when zero providers are confirmed connected in a settled world. */
  active: boolean;
  /** Which no-AI story to tell: personal space or team space. */
  variant: PickerEmptyState;
  /** Whether the viewer can reach the AI Hub at all. */
  canConnect: boolean;
  /** Opens the AI Hub. */
  connect: () => void;
}

/** The provider-scan half of the rule, supplied by the caller. */
export type ConnectAiScanSignals = Pick<
  ConnectAiComposerSignals,
  "connectedCount" | "checkingCount" | "statusesLoading" | "statusesError"
>;

/**
 * The gate from counts the caller already derived (the chat panel computes
 * them for its picker too). Reads the remaining world signals itself.
 */
export function useConnectAiDecision(
  scan: ConnectAiScanSignals,
): ConnectAiGate {
  const { capabilities, isLoading: capabilitiesLoading } = useCapabilities();
  const { isReady: catalogReady } = useProviderCatalog();
  const workspaceId = useWorkspaceStore((s) => s.current?.id ?? null);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const { variant, canConnect } = pickerEmptyState({
    teamSpace: workspaceId ? isTeamWorkspace(workspaceId) : false,
    capabilities,
    capabilitiesLoaded: !capabilitiesLoading,
  });
  const active = shouldReplaceComposerWithConnectAi({
    ...scan,
    catalogReady,
    capabilitiesLoaded: !capabilitiesLoading,
  });
  const connect = useCallback(() => setViewMode(AI_HUB_VIEW_ID), [setViewMode]);
  return { active, variant, canConnect, connect };
}

/** The gate off the shared provider-status query, for a standalone surface. */
export function useConnectAiGate(): ConnectAiGate {
  const { statuses, isLoading, isError } = useProviderStatuses();
  const counts = useMemo(() => providerConnectionCounts(statuses), [statuses]);
  return useConnectAiDecision({
    ...counts,
    statusesLoading: isLoading,
    statusesError: isError,
  });
}
