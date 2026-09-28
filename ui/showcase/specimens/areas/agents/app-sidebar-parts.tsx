import { AppSidebar, type SidebarRootEntry } from "@houston-ai/layout";
import { useState } from "react";

import { BlockRollup, RailActions, RailFoot } from "./app-sidebar-stage";
import { agentGroups, agentItems, TeamIcon } from "./sample";

export interface LiveSidebarProps {
  /** Pass `groups` and the drag-and-drop grouped layout replaces the flat list. */
  grouped?: boolean;
  /** Give every folder block its glyph. */
  teams?: boolean;
  /** Start as the 56px icon rail. The toggle stays live either way. */
  startCollapsed?: boolean;
  /** The full shell chrome: the top line's verbs and the account foot. */
  chrome?: boolean;
  /** Reserve a top row for host window controls. */
  windowControlsInset?: boolean;
  /** Which agent opens selected — how a row starts on an already-folded group. */
  initialSelectedId?: string | null;
}

/**
 * `AppSidebar` wired the way a host wires it: every callback moves real state,
 * so selecting, folding a group and dragging agents and groups anywhere in the
 * rail all behave here exactly as in the product.
 *
 * `onActivateGroup` FOLDS here, as it does in Houston's own rail. The library
 * takes no position: what activating a group heading does is the host's rule.
 */
export function LiveSidebar({
  grouped = false,
  teams = false,
  startCollapsed = false,
  chrome = false,
  windowControlsInset = false,
  initialSelectedId = "inbox-zero",
}: LiveSidebarProps) {
  const [groups, setGroups] = useState(agentGroups);
  const [order, setOrder] = useState<SidebarRootEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [collapsed, setCollapsed] = useState(startCollapsed);

  /**
   * Does this block hold the open view? Its HEADER paints active either way:
   * a block carries no destination rows, so the header is the only row that
   * can answer the question at all.
   */
  const ownsOpenView = (_blockId: string, itemIds: readonly string[]) =>
    selectedId !== null && itemIds.includes(selectedId);

  return (
    <AppSidebar
      windowControlsInset={windowControlsInset}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((on) => !on)}
      headerActions={chrome ? <RailActions collapsed={collapsed} /> : undefined}
      items={agentItems}
      order={order}
      groups={
        grouped
          ? groups.map((group) =>
              teams
                ? {
                    ...group,
                    icon: <TeamIcon />,
                    // The rollup a folded block carries on behalf of the rows
                    // it is hiding. Open, it says nothing: those rows are on
                    // screen saying it themselves.
                    ...(group.collapsed
                      ? {
                          trailing: (
                            <BlockRollup count={group.itemIds.length} />
                          ),
                        }
                      : {}),
                    active: ownsOpenView(group.id, group.itemIds),
                  }
                : group,
            )
          : undefined
      }
      selectedId={selectedId}
      onSelect={setSelectedId}
      onActivateGroup={(id) =>
        setGroups((all) =>
          all.map((group) =>
            group.id === id ? { ...group, collapsed: !group.collapsed } : group,
          ),
        )
      }
      onArrange={(arrangement) => {
        setOrder(arrangement.order);
        setGroups((all) =>
          all.map((group) => ({
            ...group,
            itemIds: arrangement.members[group.id] ?? group.itemIds,
          })),
        );
        return true;
      }}
      footer={chrome ? <RailFoot collapsed={collapsed} /> : undefined}
    />
  );
}
