import { DropdownMenuSeparator } from "@houston-ai/core";
import { Settings } from "lucide-react";
import type { MenuRow } from "./menu-row";
import { MenuItemRow, WorkspaceSwitchItems } from "./workspace-account";
import { tourAnchor } from "./workspace-tour-steps.ts";

/** The workspace menu's three runs, rendered (`sidebar-workspace-menu.tsx`
 *  names what each run is and why). */
export function SidebarWorkspaceMenuItems(props: {
  onSwitch: (workspaceId: string) => void;
  createLabel: string;
  onCreate: () => void;
  /** Admin and the gated destinations, in order; an empty list drops the
   *  run. */
  tools: MenuRow[];
  academy: MenuRow;
  settingsLabel: string;
  onOpenSettings: () => void;
}) {
  return (
    <>
      <WorkspaceSwitchItems
        onSwitch={props.onSwitch}
        createLabel={props.createLabel}
        onCreate={props.onCreate}
      />
      {props.tools.length > 0 && <DropdownMenuSeparator />}
      {props.tools.map((row) => (
        <MenuItemRow
          key={row.id}
          icon={row.icon}
          label={row.label}
          onSelect={row.onClick}
          dataAttrs={row.dataAttrs}
        />
      ))}
      <DropdownMenuSeparator />
      <MenuItemRow
        icon={props.academy.icon}
        label={props.academy.label}
        onSelect={props.academy.onClick}
        dataAttrs={props.academy.dataAttrs}
      />
      <MenuItemRow
        icon={<Settings className="size-4" aria-hidden="true" />}
        label={props.settingsLabel}
        onSelect={props.onOpenSettings}
        dataAttrs={tourAnchor("nav-settings")}
      />
    </>
  );
}
