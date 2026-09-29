import { Building2, GraduationCap, Settings } from "lucide-react";
import {
  ACADEMY_VIEW_ID,
  ADMIN_VIEW_ID,
  SETTINGS_VIEW_ID,
} from "../../lib/top-level-views";
import type { MenuRow } from "./menu-row";
import { tourAnchor } from "./workspace-tour-steps.ts";

/**
 * The destinations BOTH breakpoints draw beside the account: items in the
 * rail's account menu (`sidebar-workspace-menu.tsx`), rows in the phone's More
 * card (`mobile-more-menu.tsx`). One builder per destination, so the two can never
 * disagree on the label, the glyph, the destination or the anchor. Callers
 * resolve the label (they hold `t` over different namespace sets) and say how
 * the destination opens.
 */

/**
 * The Admin destination. Callers show it only behind the organization gate
 * (`showOrganization`).
 */
export function adminNavRow(args: {
  /** `shell:sidebar.admin`. */
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

/**
 * The Academy destination. Ungated on purpose, like Settings: every
 * deployment ships the Academy, and learning to fly is nobody's admin
 * territory.
 */
export function academyNavRow(args: {
  /** `shell:sidebar.academy`. */
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
 * The Settings destination, opened on its INDEX by the caller, never on a
 * leftover section. Report bug is a section inside it.
 */
export function settingsNavRow(args: {
  /** `shell:sidebar.settings`. */
  label: string;
  onOpen: () => void;
}): MenuRow {
  return {
    id: SETTINGS_VIEW_ID,
    label: args.label,
    icon: <Settings className="h-4 w-4" />,
    onClick: args.onOpen,
    dataAttrs: tourAnchor("nav-settings"),
  };
}
