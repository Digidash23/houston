import type { ReactNode } from "react";

/**
 * One destination the rail's account menu and the phone's More card both
 * draw: an item in the menu, a row in the card. Built once
 * (`sidebar-nav-rows.tsx`).
 */
export interface MenuRow {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** DOM attributes (tour anchors, test ids) on the rendered control. */
  dataAttrs?: Record<string, string>;
}
