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
 *
 * `apiAccessFor` is the agent whose API access screen (one level below the
 * Settings section) is open. It lives here, not in the section, so the AI
 * Manager's hands-on card can land on it; keyed on the agent so switching
 * employees never lands inside another employee's screen.
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
  apiAccessFor: string | null;
  setApiAccessFor: (agentId: string | null) => void;
}

export const useAgentSettingsNav = create<AgentSettingsNavState>((set) => ({
  requestedAgentId: null,
  requestedSection: null,
  requestAgentDetail: (agentId, section) =>
    set({ requestedAgentId: agentId, requestedSection: section ?? null }),
  clearRequested: () => set({ requestedAgentId: null, requestedSection: null }),
  shown: null,
  setShown: (shown) => set({ shown }),
  apiAccessFor: null,
  setApiAccessFor: (apiAccessFor) => set({ apiAccessFor }),
}));
