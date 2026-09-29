import {
  SidebarConnectGroup,
  type SidebarConnectRow,
  type SidebarSurface,
} from "@houston-ai/layout";
import { useTranslation } from "react-i18next";
import { useSurfaceGates } from "../../hooks/use-surface-gates";
import type { NavMode } from "../../lib/nav-stack";
import {
  AI_HUB_VIEW_ID,
  INTEGRATIONS_VIEW_ID,
} from "../../lib/top-level-views";
import { useUIStore } from "../../stores/ui";
import {
  useConnectAiLogos,
  useConnectAppsLogos,
} from "./use-connect-group-logos";
import { tourAnchor } from "./workspace-tour-steps";

interface ConnectGroupProps {
  collapsed: boolean;
  /** Default `rail`; the phone's More card passes `sheet`, so the rows are
   *  the card's own. */
  surface?: SidebarSurface;
  /** How the destination lands on the nav stack; default `push` (the rail).
   *  The phone's More card passes `reset`: reaching a destination from the
   *  menu is a tab-level move, not a level pushed onto the current tree. */
  nav?: NavMode;
  /** Runs after every navigation: closes the phone's More card. */
  onNavigate: () => void;
}

/** The apps row: Integrations, ungated, first. */
function useAppsRow(props: ConnectGroupProps): SidebarConnectRow {
  const { t } = useTranslation("shell");
  const open = useOpen(props);
  const viewMode = useUIStore((s) => s.viewMode);
  return {
    id: INTEGRATIONS_VIEW_ID,
    label: t("sidebar.connectApps"),
    logos: useConnectAppsLogos(),
    onClick: () => open(INTEGRATIONS_VIEW_ID),
    selected: viewMode === INTEGRATIONS_VIEW_ID,
    dataAttrs: tourAnchor("nav-integrations"),
  };
}

/** The AI row: the AI Models hub, behind `showAiModels`. */
function useAiRow(props: ConnectGroupProps): SidebarConnectRow {
  const { t } = useTranslation("shell");
  const open = useOpen(props);
  const viewMode = useUIStore((s) => s.viewMode);
  return {
    id: AI_HUB_VIEW_ID,
    label: t("sidebar.connectAi"),
    logos: useConnectAiLogos(),
    onClick: () => open(AI_HUB_VIEW_ID),
    selected: viewMode === AI_HUB_VIEW_ID,
    dataAttrs: tourAnchor("nav-ai-hub"),
  };
}

function useOpen(props: ConnectGroupProps): (view: string) => void {
  const setViewMode = useUIStore((s) => s.setViewMode);
  return (view) => {
    setViewMode(view, props.nav ? { nav: props.nav } : undefined);
    props.onNavigate();
  };
}

function AppsOnly(props: ConnectGroupProps) {
  return (
    <SidebarConnectGroup
      rows={[useAppsRow(props)]}
      collapsed={props.collapsed}
      surface={props.surface}
    />
  );
}

function AppsAndAi(props: ConnectGroupProps) {
  const apps = useAppsRow(props);
  const ai = useAiRow(props);
  return (
    <SidebarConnectGroup
      rows={[apps, ai]}
      collapsed={props.collapsed}
      surface={props.surface}
    />
  );
}

/**
 * The two doors to what a workspace plugs into, as two plain rail rows:
 * "Connect your apps" opens Integrations, "Connect your AI" opens the AI
 * Models hub. Each row leads with its three logos overlapped into one mark
 * (`use-connect-group-logos.tsx`), so it says what is behind it before
 * anyone opens it.
 *
 * BOTH breakpoints draw it, so it carries the destinations' tour anchors and
 * gates in one place: the rail's foot over the account row
 * (`sidebar-footer.tsx`), and the phone's More card under its switcher
 * (`mobile-more-menu.tsx`). The AI row rides `showAiModels`; with the gate
 * off it is absent and its logos are never read.
 */
export function ConnectGroup(props: ConnectGroupProps) {
  const { showAiModels } = useSurfaceGates();
  return showAiModels ? <AppsAndAi {...props} /> : <AppsOnly {...props} />;
}
