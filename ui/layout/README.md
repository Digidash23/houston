# @houston-ai/layout

App-level layout primitives: a sidebar of people, its account row, a split view for panels, and a tab bar. The Houston app mounts the sidebar family: the rail with its foot (the connect rows and the account row), and the head of the phone's More card (the workspace switcher and the connect rows). `TabBar` and `SplitView` are library primitives exercised by their showcase specimens (`ui/showcase/specimens/areas/agents/`).

## Install

```bash
pnpm add @houston-ai/layout
```

## Usage

```tsx
import { AppSidebar, TabBar, SplitView } from "@houston-ai/layout"
import "@houston-ai/layout/src/styles.css"

<AppSidebar
  headerActions={<SearchAndCreate />}
  items={people}
  selectedId={activeId}
  onSelect={setActiveId}
  footer={<SidebarProfileMenu avatar={<Face />} title="Ada" subtitle="Acme">{menuItems}</SidebarProfileMenu>}
/>

<TabBar
  tabs={[
    { id: "board", label: "Board" },
    { id: "chat", label: "Chat", badge: 2 },
  ]}
  activeTab={currentTab}
  onTabChange={setCurrentTab}
/>
```

### The grouped rail

Pass `groups` (even `[]`) and `order` to render the mixed drag-and-drop layout. `order` interleaves root items and groups; new root items lead and groups missing from `order` trail. Root items align with group headers. Only items inside a group use the child indent. Each group has one header row followed by its items, sharing the geometry in `src/sidebar-geometry.ts`.

**Every interactive line in the rail's list is one `SidebarRowButton`**: each group header and each agent. The one fork is the icon-only collapsed rail (a different anatomy, not a narrower row). `tests/sidebar-row-anatomy.test.ts` asserts that both modules go through the component and that neither restates its geometry.

The rail holds nothing but people, closed by the host's `listFooter` (typically `SidebarAddRow`). The host's verbs (search, create) sit on the top line (`headerActions`), and everything that is not a person lives in the host's footer, typically `SidebarConnectGroup` over `SidebarProfileMenu`.

```tsx
<AppSidebar
  items={agents}
  selectedId={openAgentId}
  onSelect={openAgent}
  order={layout.order}
  groups={layout.groups.map((group) => ({
    id: group.id,
    name: group.name,
    itemIds: group.agentIds,
    collapsed: group.collapsed,
    icon: <GroupGlyph group={group} />,
    // Only while FOLDED: the rows that carried these signals are not drawn.
    trailing: group.collapsed ? <NeedsYou count={group.waiting} /> : undefined,
  }))}
  // Header activation folds or unfolds the group; the host writes the new
  // `collapsed` back.
  onActivateGroup={toggleGroupFold}
  // A drop hands over the whole arrangement the rail now shows.
  onArrange={saveArrangement}
/>
```

Each folder's collapsed flag is controlled and persisted by the host. Root items follow `order` between folders. Dragging is a sortable tree over one flat row list (`sidebar-tree.ts`): the dragged row stays in the list as a faded ghost at the slot and depth it will land in, and the drop reports that exact arrangement through `onArrange` (the top-level order plus every folder's members), which answers whether it was stored: a refused drop is not drawn, and without `onArrange` nothing can be dragged or moved. Depth follows the neighbours: above a folder member the ghost is inside the folder, under an open folder header or its last member it stays at its current depth until dragged sideways (20px per level), under a collapsed folder header it is top level unless dragged right (it then joins the end of that folder), and anywhere else it is top level. A folder moves as one block among top-level rows and never nests. Its own members hide during the drag; other folders keep their visible rows. Enter and Space activate a focused row. Alt+Up and Alt+Down move it one slot; Alt+Right and Alt+Left move an agent into or out of a folder when its neighbours allow it. The host supplies drag announcements through `labels`.

`pinnedItems` lead the list: person rows drawn and selected exactly like `items` (through the same `selectedId` / `onSelect`), ahead of every folder and root row on the expanded rail and ahead of every avatar on the collapsed one, but never in a folder and never draggable. Houston pins its AI Manager there.

## Exports

- `AppSidebar` -- the rail: a top line (the collapse toggle and the host's `headerActions`), an optional full-width `headerBelow` notice, the list of people (flat or grouped into folders, `pinnedItems` first, the host's `listFooter` closing it inside the scroll box) and the host's `footer`; optional `labels` for app-level i18n
- `SidebarRowButton` -- **THE rail row.** A fixed 28px box, a 20px glyph column (a 16px Lucide mark or a 14px group mark), a truncating label, a `trailing` slot inside the button and an `affordance` slot beside it; `depth` picks the indent (`block` heads a block, `child` hangs under one), `active` paints the pill (drawn on a layer behind the content, so it can be inset without moving the glyph column) and sets `aria-current`, `disclosure` turns it into a real `<button aria-expanded aria-controls>` with a small filled triangle after the label that rotates a quarter turn when it opens
- Person rows -- every AI Employee row renders `SidebarRowButton` with `anatomy="person"`, laid out like a message list: a 64px row around a 40px portrait, the name in semibold over a muted `subtitle` of up to two lines, and the item's `trailing` badge at the end of that line. A hairline separates rows and drops away around a hovered or selected row. `sidebarPersonRow` holds that geometry
- `SidebarAddRow` -- the shortcut closing the list: a 40px row on the person row's columns (a bare 16px Plus centred in the 40px portrait column, `sidebarSeat`, the label on the names' edge), muted at rest and full ink on hover or focus, with the full-width pill and no hairline; on the icon rail the Plus alone in the avatars' column, named by a tooltip
- `SidebarConnectGroup` -- the connect rows: each a 36px rounded row led by up to three overlapping logo tiles (`SidebarConnectLogos`), then its label; the icon rail keeps the logo cluster alone, and `surface="sheet"` draws the rows as a phone card's own 48px rows (`sidebarSheetRowClasses`)
- `SidebarWorkspaceSwitcher` -- the head row of a phone card: the workspace's name and an up-down chevron on the card's own row, opening the host's workspace menu downward, headed by who is signed in
- `SidebarProfileMenu` -- the account row: a person row (portrait, name, workspace, an up-down chevron at its end) that opens a host-owned menu upward from the rail's foot, or to the right from the icon rail
- `sidebarCollapsedItem` -- an AI Employee on the collapsed icon rail: a 36px square around a 24px avatar, so the avatar and its running ring (`sidebarRingClearance`) fit inside it, with the needs-you chip on the avatar's shoulder. The rail supplies the diameter through `SidebarAvatarDiameter`; a host's avatar reads it with `useSidebarAvatarDiameter()`, so one icon node serves both rails
- `sidebarHeaderControlClasses` -- the class string the top line's controls wear (the collapse toggle, the host's search and create), exported so a host's actions match the toggle
- `sidebarRowAffordanceClasses` -- the class string a row's trailing control wears (a group's `...`)
- `SidebarGroupHeader` -- a block's header: ONE `<button aria-expanded>` carrying the glyph, the name, the disclosure triangle and an optional `trailing` rollup badge. The triangle is an INDICATOR: the whole row is the fold toggle, and `onActivate` reports the click so the host writes the new `collapsed` back
- `SidebarGroupedList`, `SidebarFlatList` -- the pieces `AppSidebar` composes, exported for hosts that assemble their own rail
- `flattenSidebar`, `projectSidebarDrop`, `arrangementFromRows` -- the pure drag model: rows, where a drop lands, and the arrangement it stores
- `computeSidebarSections` -- walks the mixed root order, fills in new items and missing groups, and renders only actual root entries
- `TabBar` -- horizontal tab strip with badges and action slots. Its consumer is the showcase specimen (`ui/showcase/specimens/areas/agents/tab-bar.tsx`)
- `SplitView` -- two-pane layout with resizable divider
- `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` -- lower-level resizable primitives

## Peer Dependencies

- React 19+
- @houston-ai/core

---

Part of [Houston](../../README.md).
