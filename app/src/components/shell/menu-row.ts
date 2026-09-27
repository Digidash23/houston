import type { ReactNode } from "react";

/**
 * One destination in a menu. The workspace menu at the rail's foot and the
 * phone's More menu list the same rows, built once
 * (`sidebar-nav-sections.tsx`, `sidebar-nav-rows.tsx`). Dependency-free, so
 * the pure models that shape the menus run under `node --test`.
 */
export interface MenuRow {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  trailing?: ReactNode;
  /** DOM attributes (tour anchors, test ids) on the rendered item. */
  dataAttrs?: Record<string, string>;
}

/** One run of rows under an optional label. */
export interface MenuSection {
  /** Stable React key. Never rendered. */
  id: string;
  label?: string;
  items: MenuRow[];
}
