import { SidebarWorkspaceMenu } from "./sidebar-workspace-menu";
import { UpdateChecker } from "./update-checker";

/**
 * The foot of the rail: the update notice when one is waiting, then the
 * workspace menu, the rail's one door to everything that is not an employee
 * (`sidebar-workspace-menu.tsx`).
 */
export function SidebarFooter(props: {
  collapsed: boolean;
  onCreateWorkspace: () => void;
}) {
  return (
    <div data-testid="sidebar-footer" className="flex flex-col">
      <UpdateChecker collapsed={props.collapsed} />
      <SidebarWorkspaceMenu
        collapsed={props.collapsed}
        onCreateWorkspace={props.onCreateWorkspace}
      />
    </div>
  );
}
