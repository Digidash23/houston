import { DropdownMenuSeparator } from "@houston-ai/core";
import { SidebarProfileMenu } from "@houston-ai/layout";
import { useTranslation } from "react-i18next";
import { useMyProfile } from "../../hooks/use-my-profile";
import { useSurfaceGates } from "../../hooks/use-surface-gates";
import { openAdmin } from "../../lib/open-admin";
import { ACADEMY_VIEW_ID } from "../../lib/top-level-views";
import { useUIStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspaces";
import { useAccountMenu } from "./sidebar-account-menu";
import { academyNavRow, adminNavRow, settingsNavRow } from "./sidebar-nav-rows";
import { SidebarProfileAvatar } from "./sidebar-profile-avatar";
import { useSidebarNavigation } from "./use-sidebar-navigation";
import {
  MenuItemRow,
  useWorkspaceCreate,
  WorkspaceSwitchItems,
} from "./workspace-account";
import { tourAnchor } from "./workspace-tour-steps.ts";

/**
 * The rail's last row: who is signed in and where, drawn like an employee
 * (their portrait, their name, the workspace under it). Single-player desktop
 * has no identity, so there the workspace takes the name line alone, beside a
 * plain person glyph.
 *
 * Pressing it opens the ONE menu holding everything that is not an employee
 * or a connection, in runs: who is signed in; every workspace the person
 * belongs to and creating one (`useWorkspaceCreate` routes that on Spaces);
 * the person's Profile and About me (`useAccountMenu`); Admin behind the org
 * gate, the Academy and Settings (opened on its INDEX); and Sign out.
 */
export function SidebarWorkspaceMenu(props: {
  collapsed: boolean;
  onCreateWorkspace: () => void;
}) {
  const { t } = useTranslation("shell");
  const { showOrganization } = useSurfaceGates();
  const profile = useMyProfile();
  const workspaceName = useWorkspaceStore(
    (s) => s.current?.name ?? t("sidebar.selectWorkspace"),
  );
  const openSettings = useUIStore((s) => s.openSettings);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const setMobileMoreOpen = useUIStore((s) => s.setMobileMoreOpen);
  // Every rail navigation closes the phone's More menu, the rule the rest of
  // the rail follows, so a window resized across the breakpoint never lands
  // on a stale open menu.
  const closeMobileMenu = () => setMobileMoreOpen(false);
  const { switchWorkspace } = useSidebarNavigation({ closeMobileMenu });
  const account = useAccountMenu({ onNavigate: closeMobileMenu });
  const create = useWorkspaceCreate(props.onCreateWorkspace);
  const destinations = [
    ...(showOrganization
      ? [adminNavRow({ label: t("sidebar.admin"), onOpen: () => openAdmin() })]
      : []),
    academyNavRow({
      label: t("sidebar.academy"),
      onOpen: () => setViewMode(ACADEMY_VIEW_ID),
    }),
    settingsNavRow({
      label: t("sidebar.settings"),
      onOpen: () => openSettings(null),
    }),
  ];

  return (
    <>
      <SidebarProfileMenu
        avatar={
          <SidebarProfileAvatar
            name={profile?.name ?? null}
            avatarUrl={profile?.avatarUrl ?? null}
          />
        }
        title={profile?.name ?? workspaceName}
        subtitle={profile ? workspaceName : undefined}
        collapsed={props.collapsed}
        dataAttrs={tourAnchor("workspaceMenu")}
      >
        {account.header}
        <WorkspaceSwitchItems
          onSwitch={switchWorkspace}
          createLabel={create.label}
          onCreate={create.onCreate}
        />
        <DropdownMenuSeparator />
        {account.personal}
        <DropdownMenuSeparator />
        {destinations.map((row) => (
          <MenuItemRow
            key={row.id}
            icon={row.icon}
            label={row.label}
            onSelect={row.onClick}
            dataAttrs={row.dataAttrs}
          />
        ))}
        {account.signOut}
      </SidebarProfileMenu>
      {create.dialog}
    </>
  );
}
