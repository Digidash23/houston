import type { Specimen } from "../../../src/specimen";
import { specimen as appSidebar } from "./app-sidebar";
import { specimen as filesBrowser } from "./files-browser";
import { specimen as sidebarGroupHeader } from "./sidebar-group-header";
import { specimen as sidebarProfileMenu } from "./sidebar-profile-menu";
import { specimen as sidebarRowButton } from "./sidebar-row-button";
import { specimen as sidebarWorkspaceSwitcher } from "./sidebar-workspace-switcher";
import { specimen as splitView } from "./split-view";
import { specimen as tabBar } from "./tab-bar";

/**
 * The **Your Agents** area: the frame the product lives in — the rail of
 * agents and its groups, the account row at its foot — and the two
 * surfaces behind Agent Settings. `TabBar` is here as a library component the
 * app no longer mounts (see its page).
 *
 * One file per component in this folder (`<component>.tsx`, each exporting
 * `export const specimen: Specimen` with `group: "Your Agents"` alongside
 * `export const sources: string[]`), imported here and listed below in the
 * order a user meets them: the rail from the outside in -- the row primitive
 * every line in it is built from, then the presets, then the whole rail --
 * then the split view, then the panels it holds. Shared sample content lives in `sample.tsx`; the
 * live wiring and the props tables sit in the `*-parts.tsx` / `*-api.ts` /
 * `*-sample.ts` helpers beside each page.
 *
 * The agent avatar itself is deliberately not here: `AgentAvatar` and
 * `HoustonAvatar` are `@houston-ai/core` primitives, documented under Data
 * display and merely *used* by this area's sample content.
 */
export const specimens: readonly Specimen[] = [
  sidebarRowButton,
  sidebarGroupHeader,
  sidebarProfileMenu,
  sidebarWorkspaceSwitcher,
  appSidebar,
  tabBar,
  splitView,
  filesBrowser,
];
