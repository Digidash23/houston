/**
 * "Is there no AI connected, and can this viewer go connect one?" as ONE pure
 * decision, for every surface that would otherwise start a turn no provider
 * can answer: the chat composer and the first-day start button and banner.
 * It folds the one connection derivation (`providerConnectionCounts`), the
 * composer's conservative rule (`shouldReplaceComposerWithConnectAi`: anything
 * uncertain keeps the normal action) and the picker's empty-state story
 * (`pickerEmptyState`: which copy, and whether the AI Hub is reachable).
 *
 * Pure so the whole decision is unit-testable without React; the hook that
 * feeds it the live signals is `hooks/use-connect-ai-gate.ts`.
 */

import type { Capabilities } from "@houston/engine-adapter";
import {
  type PickerEmptyState,
  pickerEmptyState,
} from "../components/chat-model-selector-labels.ts";
import {
  providerConnectionCounts,
  shouldReplaceComposerWithConnectAi,
} from "./composer-connect-ai.ts";
import type { ProviderConnectionStatus } from "./provider-connection.ts";

export interface ConnectAiGateInput {
  /** The provider scan's statuses (`useProviderStatuses().statuses`). */
  statuses: Record<string, ProviderConnectionStatus>;
  statusesLoading: boolean;
  statusesError: boolean;
  /** The runnable provider/model catalog landed. */
  catalogReady: boolean;
  capabilities: Capabilities | null;
  capabilitiesLoaded: boolean;
  /** The active space is a team space. */
  teamSpace: boolean;
}

export interface ConnectAiGateState {
  /** True when zero providers are confirmed connected in a settled world. */
  active: boolean;
  /** Which no-AI story to tell: personal space or team space. */
  variant: PickerEmptyState;
  /** Whether the viewer can reach the AI Hub at all. */
  canConnect: boolean;
}

export function connectAiGateState(
  input: ConnectAiGateInput,
): ConnectAiGateState {
  const { variant, canConnect } = pickerEmptyState({
    teamSpace: input.teamSpace,
    capabilities: input.capabilities,
    capabilitiesLoaded: input.capabilitiesLoaded,
  });
  const active = shouldReplaceComposerWithConnectAi({
    ...providerConnectionCounts(input.statuses),
    statusesLoading: input.statusesLoading,
    statusesError: input.statusesError,
    catalogReady: input.catalogReady,
    capabilitiesLoaded: input.capabilitiesLoaded,
  });
  return { active, variant, canConnect };
}
