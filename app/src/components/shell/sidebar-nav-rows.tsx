import { Boxes, Building2, GraduationCap } from "lucide-react";
import {
  ACADEMY_VIEW_ID,
  ADMIN_VIEW_ID,
  AI_HUB_VIEW_ID,
} from "../../lib/top-level-views";
import type { MenuRow } from "./menu-row";
import type { SidebarChromeT } from "./sidebar-chrome";
import { tourAnchor } from "./workspace-tour-steps.ts";

/** The rail's GATED rows, keyed by the gate each one rides. */
export interface GatedNavRows {
  /** `showAiModels` — the AI Models hub, leading the shared run. */
  aiModels: MenuRow;
}

/**
 * The rows a gate can take away, built apart from the runs that compose them
 * (`sidebar-nav-sections.tsx`).
 *
 * AI Models carries its tour anchor, so keeping it here leaves the
 * composition file free to state the information architecture and nothing
 * else. The UNGATED rows stay inline
 * there: a row every deployment has is part of the IA, not a variable in it.
 */
export function gatedNavRows(args: {
  t: SidebarChromeT;
  setViewMode: (view: string) => void;
}): GatedNavRows {
  const { t, setViewMode } = args;
  return {
    aiModels: {
      id: AI_HUB_VIEW_ID,
      label: t("shell:sidebar.aiModels"),
      icon: <Boxes className="h-4 w-4" />,
      onClick: () => setViewMode(AI_HUB_VIEW_ID),
      dataAttrs: tourAnchor("nav-ai-hub"),
    },
  };
}

/**
 * The Academy row, built here because BOTH breakpoints draw it: the workspace
 * menu's last run, right above Settings (`sidebar-workspace-menu.tsx`), and
 * the tail of the phone's More menu (`mobile-more-menu.tsx`). One row, one
 * label, one destination, whichever menu renders it.
 *
 * It is ungated on purpose, like Settings beside it: every deployment ships
 * the Academy, and learning to fly is nobody's admin territory. The Houston
 * tour lesson ends on it, so it carries the `nav-academy` anchor on both.
 */
export function academyNavRow(args: {
  /** `shell:sidebar.academy`, resolved by the caller: the two clusters that
   *  draw this row hold `t` over different namespace sets. */
  label: string;
  onOpen: () => void;
}): MenuRow {
  return {
    id: ACADEMY_VIEW_ID,
    label: args.label,
    icon: <GraduationCap className="h-4 w-4" />,
    onClick: args.onOpen,
    dataAttrs: tourAnchor("nav-academy"),
  };
}

/**
 * The Admin row, built once for both breakpoints: the head of the workspace
 * run in the rail's menu and in the phone's More card. Callers show it only
 * behind the organization gate (`showOrganization`).
 */
export function adminNavRow(args: {
  /** `shell:sidebar.admin`, resolved by the caller. */
  label: string;
  onOpen: () => void;
}): MenuRow {
  return {
    id: ADMIN_VIEW_ID,
    label: args.label,
    icon: <Building2 className="h-4 w-4" />,
    onClick: args.onOpen,
    dataAttrs: { "data-testid": "rail-admin" },
  };
}
