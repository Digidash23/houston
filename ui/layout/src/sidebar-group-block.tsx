import { cn } from "@houston-ai/core";
import { sidebarRowHeight } from "./sidebar-geometry";
import {
  sidebarRowButtonClasses as c,
  sidebarMemberGuide,
} from "./sidebar-paint";
import { type SidebarTreeRow, treeRowKey } from "./sidebar-tree";

/**
 * Open groups with no member rows. Read off the AT-REST rows, never the drag
 * projection: the hint is not sortable, so adding or removing it mid-drag
 * would move every row below it under the pointer.
 */
export function emptyOpenGroupIds(rows: SidebarTreeRow[]): Set<string> {
  const empty = new Set<string>();
  rows.forEach((row, index) => {
    if (row.kind !== "group" || row.collapsed) return;
    const next = rows[index + 1];
    if (next?.kind === "agent" && next.parentId === row.id) return;
    empty.add(row.id);
  });
  return empty;
}

/**
 * Keys of the rows that open a block, which take the block gap: every group
 * header but the first row, and a root agent right after a group's block.
 * Root agents in a run stay one list.
 */
export function blockStartKeys(rows: SidebarTreeRow[]): Set<string> {
  const starts = new Set<string>();
  rows.forEach((row, index) => {
    const prev = rows[index - 1];
    if (!prev) return;
    const afterGroup = prev.kind === "group" || prev.parentId !== null;
    if (row.kind === "group" || (row.parentId === null && afterGroup))
      starts.add(treeRowKey(row));
  });
  return starts;
}

/**
 * The line under an open group that holds nobody. Without it an empty group's
 * header folds and unfolds with nothing visibly changing, and the top-level
 * rows drawn right below it read as its members.
 */
export function SidebarEmptyGroupHint({
  groupId,
  label,
}: {
  groupId: string;
  label: string;
}) {
  return (
    <div
      data-sidebar-empty-group={groupId}
      className={cn(
        "relative flex items-center text-xs text-ink-muted",
        sidebarRowHeight,
        c.depthChild,
        sidebarMemberGuide,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}
