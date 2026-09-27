import { Blocks } from "lucide-react";
import { INTEGRATIONS_VIEW_ID } from "../integrations-view";
import type { MenuSection } from "./menu-row";
import type { SidebarChromeT } from "./sidebar-chrome";
import { gatedNavRows } from "./sidebar-nav-rows";
import { tourAnchor } from "./workspace-tour-steps.ts";

/**
 * The workspace's shared destinations: AI Models, then Integrations, as ONE
 * unlabelled run.
 *
 * They are what the workspace SHARES rather than where daily work happens, so
 * they sit in the middle run of the workspace menu at the rail's foot
 * (`sidebar-workspace-menu.tsx`) and in the phone's More menu, both built from
 * this list, rather than on the rail above the employees. Skills are managed
 * in each employee's own settings.
 *
 * A section the gates empty is dropped by every renderer, so a run can never
 * outlive the rows it names.
 *
 * What lives elsewhere, on purpose: the AI Manager is a member of the team,
 * pinned first in the rail's list (`sidebar-manager-row.tsx`). Admin (members,
 * roles, activity, time worked, the org chart) leads this same run in the
 * menu, gated on `showOrganization`, because it administers the workspace
 * these tools belong to. About me is a Settings section. The Academy and
 * Settings are the menu's last run, the person's own.
 */
export function buildSidebarNavItems(args: {
  t: SidebarChromeT;
  showAiModels: boolean;
  setViewMode: (view: string) => void;
}): MenuSection[] {
  const { t, showAiModels, setViewMode } = args;
  const { aiModels } = gatedNavRows({ t, setViewMode });
  return [
    {
      id: "primary",
      items: [
        ...(showAiModels ? [aiModels] : []),
        {
          id: INTEGRATIONS_VIEW_ID,
          label: t("shell:sidebar.integrations"),
          icon: <Blocks className="h-4 w-4" />,
          onClick: () => setViewMode(INTEGRATIONS_VIEW_ID),
          dataAttrs: tourAnchor("nav-integrations"),
        },
      ],
    },
  ];
}
