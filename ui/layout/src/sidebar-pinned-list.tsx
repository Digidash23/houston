import type { SidebarItem } from "./sidebar";
import { sidebarClasses } from "./sidebar-geometry";
import { SidebarItemRow } from "./sidebar-item-row";
import type { SidebarBaseRowContext } from "./sidebar-row-context";

export interface SidebarPinnedListProps {
  items: SidebarItem[];
  ctx: SidebarBaseRowContext;
}

/**
 * The expanded rail's pinned rows, ahead of every group: person rows exactly
 * like an agent's, selected through the same `selectedId` / `onSelect`, but
 * outside every drag container, the list's scroll box and the band's fold, so
 * they neither drag nor wear the grab cursor, no drop can land above them,
 * and they stay in view while the list is folded or scrolled. The collapsed
 * rail has no groups and simply lists them first.
 */
export function SidebarPinnedList({ items, ctx }: SidebarPinnedListProps) {
  if (items.length === 0) return null;
  return (
    <div className={sidebarClasses.pinnedList}>
      {items.map((item) => (
        <SidebarItemRow
          key={item.id}
          item={item}
          isActive={item.id === ctx.selectedId}
          onSelect={ctx.onSelect}
          draggable={false}
        />
      ))}
    </div>
  );
}
