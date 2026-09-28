import { useSurfaceGates } from "../../hooks/use-surface-gates";
import type { NavMode } from "../../lib/nav-stack";
import { useUIStore } from "../../stores/ui";
import type { MenuSection } from "./menu-row";
import type { SidebarChromeT } from "./sidebar-chrome";
import { buildSidebarNavItems } from "./sidebar-nav-sections";

/**
 * The workspace's shared destinations, gated for this caller.
 *
 * Every entry navigates AND closes the phone's More menu, the one rule every
 * row shares, so it is applied here instead of at each call site.
 *
 * Admin and the person's own run (the Academy, Settings) are not here: the
 * workspace menu and the phone's More menu each place them around these.
 */
export function useSidebarNavItems(
  t: SidebarChromeT,
  closeMobileMenu: () => void,
  opts?: {
    /** How the destination lands on the nav stack; default `push` (the rail).
     *  The phone's More menu passes `reset`: reaching a destination from the
     *  menu is a tab-level move, not a level pushed onto the current tree. */
    nav?: NavMode;
  },
): { navSections: MenuSection[] } {
  const { showAiModels } = useSurfaceGates();
  const setViewMode = useUIStore((s) => s.setViewMode);
  return {
    navSections: buildSidebarNavItems({
      t,
      showAiModels,
      setViewMode: (view) => {
        setViewMode(view, opts?.nav ? { nav: opts.nav } : undefined);
        closeMobileMenu();
      },
    }),
  };
}
