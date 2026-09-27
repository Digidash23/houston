import { SidebarProfileMenu } from "@houston-ai/layout";
import { useTranslation } from "react-i18next";
import { useSurfaceGates } from "../../hooks/use-surface-gates";
import { openAdmin } from "../../lib/open-admin";
import { ACADEMY_VIEW_ID } from "../../lib/top-level-views";
import { useUIStore } from "../../stores/ui";
import { academyNavRow, adminNavRow } from "./sidebar-nav-rows";
import { SidebarWorkspaceMenuItems } from "./sidebar-workspace-menu-items";
import { useSidebarNavItems } from "./use-sidebar-nav-items";
import { useSidebarNavigation } from "./use-sidebar-navigation";
import { useAccountFace, useWorkspaceCreate } from "./workspace-account";
import { tourAnchor } from "./workspace-tour-steps.ts";

/**
 * The rail's foot: who is signed in and where (`useAccountFace`), and the one
 * menu holding everything that is not an employee, in three runs.
 *
 * 1. **The workspace**: every space the person belongs to, and creating one
 *    (`useWorkspaceCreate` routes that on Spaces).
 * 2. **Running the workspace**: Admin first (members, roles, activity, time
 *    worked, the org chart), only for a caller the org gate admits
 *    (`showOrganization`), then the gated destinations the workspace shares
 *    (AI Models, Integrations), built by `useSidebarNavItems` exactly as the
 *    phone's More card builds them, so the two breakpoints list the same
 *    destinations behind the same gates and tour anchors.
 * 3. **The person**: the Academy, then Settings (opened on its INDEX, never a
 *    leftover section; Report bug is a section inside it).
 */
export function SidebarWorkspaceMenu(props: {
  collapsed: boolean;
  onCreateWorkspace: () => void;
}) {
  const { t } = useTranslation(["shell", "common", "teams"]);
  const { showOrganization } = useSurfaceGates();
  const openSettings = useUIStore((s) => s.openSettings);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const setMobileMoreOpen = useUIStore((s) => s.setMobileMoreOpen);
  // Every rail navigation closes the phone's More menu, the rule the rest of
  // the rail follows, so a window resized across the breakpoint never lands
  // on a stale open menu.
  const closeMobileMenu = () => setMobileMoreOpen(false);
  const { navSections } = useSidebarNavItems(t, closeMobileMenu);
  const { switchWorkspace } = useSidebarNavigation({ closeMobileMenu });
  const face = useAccountFace();
  const create = useWorkspaceCreate(props.onCreateWorkspace);

  return (
    <>
      <SidebarProfileMenu
        avatar={face.avatar}
        title={face.title}
        subtitle={face.subtitle}
        collapsed={props.collapsed}
        dataAttrs={tourAnchor("workspaceMenu")}
      >
        <SidebarWorkspaceMenuItems
          onSwitch={switchWorkspace}
          createLabel={create.label}
          onCreate={create.onCreate}
          tools={[
            ...(showOrganization
              ? [
                  adminNavRow({
                    label: t("shell:sidebar.admin"),
                    onOpen: () => openAdmin(),
                  }),
                ]
              : []),
            ...navSections.flatMap((section) => section.items),
          ]}
          academy={academyNavRow({
            label: t("shell:sidebar.academy"),
            onOpen: () => setViewMode(ACADEMY_VIEW_ID),
          })}
          settingsLabel={t("shell:sidebar.settings")}
          onOpenSettings={() => openSettings(null)}
        />
      </SidebarProfileMenu>
      {create.dialog}
    </>
  );
}
