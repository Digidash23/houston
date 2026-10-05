import { cn } from "@houston-ai/core";
import { sidebarRowHeight } from "./sidebar-geometry";
import { sidebarRowButtonClasses as c } from "./sidebar-paint";
import type { SidebarTreeRow } from "./sidebar-tree";

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
        "flex items-center text-xs text-ink-muted",
        sidebarRowHeight,
        c.depthChild,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}
