import { Sheet, SheetContent, SheetTitle } from "@houston-ai/core";
import { SidebarProfileMenu } from "@houston-ai/layout";
import { Settings } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSurfaceGates } from "../../hooks/use-surface-gates";
import { openAdmin } from "../../lib/open-admin";
import { ACADEMY_VIEW_ID, SETTINGS_VIEW_ID } from "../../lib/top-level-views";
import { useUIStore } from "../../stores/ui";
import type { MenuRow } from "./menu-row";
import { mobileMoreItems } from "./mobile-more-items";
import { MobileMoreBand, MobileMoreRowButton } from "./mobile-more-row";
import { SidebarDialogs } from "./sidebar-dialogs";
import { academyNavRow, adminNavRow } from "./sidebar-nav-rows";
import { useSidebarNavItems } from "./use-sidebar-nav-items";
import { useSidebarNavigation } from "./use-sidebar-navigation";
import {
  useAccountFace,
  useWorkspaceCreate,
  WorkspaceSwitchItems,
} from "./workspace-account";
import { tourAnchor } from "./workspace-tour-steps";

/**
 * The phone's "More": a floating card raised by the nav bar, headed by the
 * account row (the same person-over-workspace row as the desktop rail's foot,
 * whose menu switches or creates a workspace) and holding the long tail of
 * destinations.
 *
 * A card and not a full bottom sheet, because it is a MENU: it answers "where
 * else can I go" and then gets out of the way, so it hovers over the bar that
 * raised it rather than taking the screen. It is a Radix dialog under the
 * restyle, so it isolates the app on its own while open.
 *
 * The destinations are the RAIL's (`useSidebarNavItems`), so the phone can
 * never drift from the desktop on what exists, what a gate hides, or which
 * element a tour anchor names. They navigate with `nav: "reset"`: reaching a
 * destination from the menu is a tab-level move, not a level pushed onto the
 * tree the user was in.
 *
 * The runs follow the desktop menu's: Admin (behind the org gate) leads the
 * workspace's tools, and the Academy and Settings close the list.
 */
export function MobileMoreMenu() {
  const { t } = useTranslation(["shell", "common", "teams"]);
  const { showOrganization } = useSurfaceGates();
  const open = useUIStore((s) => s.mobileMoreOpen);
  const setOpen = useUIStore((s) => s.setMobileMoreOpen);
  const openSettings = useUIStore((s) => s.openSettings);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const face = useAccountFace();
  const create = useWorkspaceCreate(() => setCreateWsOpen(true));

  const { navSections } = useSidebarNavItems(t, close, { nav: "reset" });
  const groups = mobileMoreItems(navSections);
  // The SAME Academy row the rail draws (`sidebar-nav-rows.tsx`), so the two
  // breakpoints cannot drift.
  const academy = academyNavRow({
    label: t("shell:sidebar.academy"),
    onOpen: () => {
      setViewMode(ACADEMY_VIEW_ID, { nav: "reset" });
      close();
    },
  });
  const admin = adminNavRow({
    label: t("shell:sidebar.admin"),
    onOpen: () => openAdmin({ nav: "reset" }),
  });
  const settings: MenuRow = {
    id: SETTINGS_VIEW_ID,
    label: t("shell:sidebar.settings"),
    icon: <Settings className="h-4 w-4" />,
    dataAttrs: tourAnchor("nav-settings"),
    onClick: () => {
      // Settings opens on its INDEX, never a leftover section.
      openSettings(null, { nav: "reset" });
      close();
    },
  };
  const { switchWorkspace } = useSidebarNavigation({
    closeMobileMenu: close,
  });

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          data-testid="mobile-more-menu"
          showCloseButton={false}
          aria-describedby={undefined}
          className="inset-x-3 bottom-[calc(env(safe-area-inset-bottom)_+_5.5rem)] max-h-[70dvh] gap-0 rounded-3xl border-0 border-t-0 bg-popover p-0"
        >
          <SheetTitle className="sr-only">
            {t("shell:moreMenu.title")}
          </SheetTitle>
          <div className="pt-1">
            <SidebarProfileMenu
              avatar={face.avatar}
              title={face.title}
              subtitle={face.subtitle}
              side="bottom"
              dataAttrs={{ "data-testid": "more-account" }}
            >
              <WorkspaceSwitchItems
                onSwitch={switchWorkspace}
                createLabel={create.label}
                onCreate={() => {
                  // The create dialog stands on its own: the card steps aside.
                  close();
                  create.onCreate();
                }}
              />
            </SidebarProfileMenu>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {showOrganization && <MobileMoreRowButton row={admin} />}
            {groups.map((group) => (
              <div key={group.id}>
                {group.label && <MobileMoreBand label={group.label} />}
                {group.items.map((row) => (
                  <MobileMoreRowButton key={row.id} row={row} />
                ))}
              </div>
            ))}
            <div className="border-line border-t">
              <MobileMoreRowButton row={academy} />
              <MobileMoreRowButton row={settings} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
      {/* Outside the sheet on purpose: picking "Create workspace" closes the
          menu, and a dialog mounted inside it would unmount with it. */}
      <SidebarDialogs
        createWorkspaceOpen={createWsOpen}
        onCreateWorkspaceOpenChange={setCreateWsOpen}
      />
      {create.dialog}
    </>
  );
}
