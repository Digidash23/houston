import { ManagerAvatar } from "@houston-ai/core";
import { type SidebarItem, useSidebarAvatarDiameter } from "@houston-ai/layout";
import { useManagerReachable } from "../../hooks/use-manager-reachable";
import { useUIStore } from "../../stores/ui";
import { ASSISTANT_VIEW_ID } from "../assistant/id";
import type { SidebarChromeT } from "./sidebar-chrome";
import { bandSelectedId, routeBandSelect } from "./sidebar-manager-selection";

/** The Manager's avatar at the diameter of the rail slot it renders in: the
 *  person row's portrait expanded, the smaller avatar collapsed. */
function ManagerSidebarIcon() {
  return <ManagerAvatar size={useSidebarAvatarDiameter()} />;
}

/**
 * The AI Manager as the employees band's pinned first row, and the band's
 * selection with it folded in.
 *
 * The band has ONE `selectedId` and ONE `onSelect`, so the Manager rides them
 * under its view id (`sidebar-manager-selection.ts`): lit while the assistant
 * view is open, and selecting it opens that view instead of an agent's team
 * board. Gated on reachability (`useManagerReachable`), not on a role: a
 * deployment that serves no assistant has no row once no onboarding runs in
 * it. The test id tells it apart from an agent the person happened to name
 * "Houston".
 */
export function useSidebarManagerRow(args: {
  t: SidebarChromeT;
  selectedAgentId: string | null;
  selectAgent: (agentId: string) => void;
  closeMobileMenu: () => void;
}): {
  pinnedItems: SidebarItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
} {
  const { t, selectedAgentId, selectAgent, closeMobileMenu } = args;
  const reachable = useManagerReachable();
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const pinnedItems: SidebarItem[] = reachable
    ? [
        {
          id: ASSISTANT_VIEW_ID,
          name: t("shell:sidebar.assistant"),
          subtitle: t("shell:sidebar.assistantRole"),
          icon: <ManagerSidebarIcon />,
          dataAttrs: { "data-testid": "rail-assistant" },
        },
      ]
    : [];
  return {
    pinnedItems,
    selectedId: bandSelectedId(viewMode, selectedAgentId),
    onSelect: (id) =>
      routeBandSelect(id, {
        openManager: () => {
          setViewMode(ASSISTANT_VIEW_ID);
          closeMobileMenu();
        },
        selectAgent,
      }),
  };
}
