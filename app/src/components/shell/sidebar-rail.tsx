import type {
  SidebarArrangement,
  SidebarGroupView,
  SidebarItem,
  SidebarRootEntry,
} from "@houston-ai/layout";
import { AppSidebar, SidebarAddRow } from "@houston-ai/layout";
import type { ReactNode } from "react";
import { SidebarInviteInbox } from "./pending-invites";
import { buildSidebarLabels, type SidebarChromeT } from "./sidebar-chrome";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeaderActions } from "./sidebar-header-actions";

/** Everything the rail RENDERS, resolved by `Sidebar` and handed over whole. */
export interface SidebarRailModel {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onExpand: () => void;
  onCreateWorkspace: () => void;
  /** Stores a drop: the whole arrangement the rail now shows. False when
   *  nothing was written, so the rail keeps the stored order. */
  onArrange: (arrangement: SidebarArrangement) => boolean;
  ready: boolean;
  items: SidebarItem[];
  /** Rows leading the list, ahead of every folder: the AI Manager. */
  pinnedItems: SidebarItem[];
  groups: SidebarGroupView[];
  order: SidebarRootEntry[];
  /** The lit row: an agent, or a pinned row's id. */
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  /** Fold or unfold a folder from its heading. */
  onActivateGroup: (id: string) => void;
  /** Opens the create sheet on a new folder; the rail withholds it until the
   *  layout read succeeds. */
  onNewTeam: () => void;
  /** Absent when this caller may not create agents: neither the top line's
   *  create menu offers it nor the list's add shortcut is drawn. */
  onAddAgent: (() => void) | undefined;
}

/**
 * The rail itself: one `AppSidebar` invocation, fed entirely by the view model
 * `Sidebar` composed. The phone does not render this rail: it manages
 * employees and groups from the AI Employees list.
 *
 * Three zones, top to bottom. The top line holds the rail's two verbs, search
 * and create (`sidebar-header-actions.tsx`). The body is the team and nothing
 * else: the AI Manager pinned first, then the folders and employees in the
 * person's own order, with no heading over them because they are the whole
 * rail, closed by the "Add new AI Employee" shortcut for a caller who may
 * create one. The foot (`sidebar-footer.tsx`) holds the connect rows and the
 * person's own row, the door to everything else.
 *
 * Pending invitations keep their own full-width band right under the top line:
 * they are an action waiting on the person, not a place in a menu.
 */
export function SidebarRail({
  model,
  t,
  windowControlsInset = false,
  gutterChildren,
}: {
  model: SidebarRailModel;
  t: SidebarChromeT;
  windowControlsInset?: boolean;
  /** The floating "screen" the desktop rail sits beside. */
  gutterChildren?: ReactNode;
}) {
  const { collapsed, ready } = model;
  return (
    <AppSidebar
      windowControlsInset={windowControlsInset}
      collapsed={collapsed}
      onToggleCollapsed={model.onToggleCollapsed}
      headerActions={
        <SidebarHeaderActions
          t={t}
          collapsed={collapsed}
          onNewAgent={model.onAddAgent}
          onNewTeam={ready ? model.onNewTeam : undefined}
        />
      }
      headerBelow={
        <SidebarInviteInbox collapsed={collapsed} onExpand={model.onExpand} />
      }
      items={model.items}
      pinnedItems={model.pinnedItems}
      groups={model.groups}
      order={model.order}
      onActivateGroup={ready ? model.onActivateGroup : undefined}
      onArrange={ready ? model.onArrange : undefined}
      selectedId={model.selectedAgentId}
      onSelect={model.onSelectAgent}
      labels={buildSidebarLabels(t)}
      listFooter={
        model.onAddAgent && (
          <SidebarAddRow
            label={t("shell:sidebar.addEmployee")}
            onClick={model.onAddAgent}
            collapsed={collapsed}
            dataAttrs={{ "data-testid": "rail-add-employee" }}
          />
        )
      }
      footer={
        <SidebarFooter
          collapsed={collapsed}
          onCreateWorkspace={model.onCreateWorkspace}
        />
      }
    >
      {gutterChildren}
    </AppSidebar>
  );
}
