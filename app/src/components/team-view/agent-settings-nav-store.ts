import { create } from "zustand";
import type { AgentSettingsSection } from "../agent-settings/agent-settings-nav.ts";

/**
 * A one-shot request to open one focused agent's settings, optionally on a
 * specific section. Deep links set the request before opening the focused
 * agent screen; `AgentSettingsPane` consumes and clears it.
 *
 * `shown` is the other direction: the section the mounted pane is showing,
 * so a caller deciding whether to navigate (a notification's "already there"
 * rule) can read where the person actually is.
 */
interface AgentSettingsNavState {
  requestedAgentId: string | null;
  requestedSection: AgentSettingsSection | null;
  requestAgentDetail: (agentId: string, section?: AgentSettingsSection) => void;
  clearRequested: () => void;
  shown: { agentId: string; section: AgentSettingsSection } | null;
  setShown: (
    shown: { agentId: string; section: AgentSettingsSection } | null,
  ) => void;
}

export const useAgentSettingsNav = create<AgentSettingsNavState>((set) => ({
  requestedAgentId: null,
  requestedSection: null,
  requestAgentDetail: (agentId, section) =>
    set({ requestedAgentId: agentId, requestedSection: section ?? null }),
  clearRequested: () => set({ requestedAgentId: null, requestedSection: null }),
  shown: null,
  setShown: (shown) => set({ shown }),
}));
