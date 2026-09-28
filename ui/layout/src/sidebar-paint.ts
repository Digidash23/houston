import {
  sidebarIconBox,
  sidebarIconGap,
  sidebarPersonRow,
  sidebarRowEndMargin,
  sidebarRowEndPad,
  sidebarRowHeight,
  sidebarTrailingGap,
} from "./sidebar-geometry";

/**
 * The rail's PAINT LAYER: one inset, rounded pill drawn behind every row.
 *
 * Radius and inset live HERE and in no other string, which is the point. A
 * fill spanning the rail edge to edge is a bar, not a pill: at 28px tall and
 * 204px wide an 8px corner is invisible, and the rail reads as a stack of
 * rectangles rather than as macOS/Linear-style rows floating on a surface.
 * Pulling the paint 6px in from each side is what makes the corner legible, and
 * `rounded-lg` gives the selected row a visible corner at this width.
 *
 * It is a `::before` and not the row's own background because the row is also
 * what carries the geometry: inset the element and the glyph column moves with
 * it (invariant 2). A pseudo-element paints, spans nothing and pushes nothing,
 * so the indent is untouched by construction. Its siblings (the button, the
 * "..." affordance) are positioned so they paint ON TOP of it — the pseudo is
 * positioned, and a positioned box beats static content in the painting order.
 *
 * The FOCUS RING rides the same layer, scoped to the row's own button (`>
 * button:first-child`), so it traces the pill exactly rather than a rectangle
 * 12px wider than the fill it is meant to be outlining. The affordance beside
 * it keeps its own ring: it is a separate control, not part of the row's pill.
 */
export const sidebarRowFill =
  "before:pointer-events-none before:absolute before:inset-y-0 before:right-1.5 before:left-1.5 before:rounded-lg before:transition-colors before:duration-100 before:content-[''] has-[>button:first-child:focus-visible]:before:ring-2 has-[>button:first-child:focus-visible]:before:ring-focus";

/**
 * Hover / active / rest paint, identical for every row and spent on
 * {@link sidebarRowFill}'s layer.
 *
 * The two fills are one token each, and the pair is deliberately a RATIO: the
 * hover wash is `sidebar-hover` (6% ink on light, 6% white on dark) and the
 * selected pill is `sidebar-active` (10% both). 6-of-10 is the whole design —
 * far enough under the pill that a hovered row never reads as selected, far
 * enough over the canvas that the row you are pointing at is unmistakable in
 * both themes. The previous `bg-hover/50` resolved to roughly 3% (light) and 4%
 * (dark), which is under the perceptual floor on a laptop panel: the rail had
 * no hover at all as far as anyone could see.
 */
export const sidebarRowState = {
  active: "before:bg-sidebar-active text-ink",
  hover: "hover:before:bg-sidebar-hover",
  /** The resting LABEL colour, for a row whose fill lives on its root. */
  restText: "text-hover-text",
} as const;

/**
 * {@link SidebarRowButton}'s anatomy. The root hosts the PAINT
 * ({@link sidebarRowFill}, an inset pill on its `::before`) and spans the rail
 * so the affordance sits inside the row; the button carries the geometry and
 * the indent, full width, and is positioned only so it paints above the pill.
 */
export const sidebarRowButtonClasses = {
  root: `group/row relative ${sidebarRowHeight} flex w-full min-w-0 items-center ${sidebarRowFill}`,
  button: `relative flex ${sidebarRowHeight} min-w-0 flex-1 items-center ${sidebarRowEndPad} text-left focus-visible:outline-none`,
  /** Heads a block: sits one step left of everything it contains, on the same
   *  12px edge as a root person row's portrait (`sidebarPersonRow.padBlock`),
   *  so folder headers and root employees share one left edge. */
  depthBlock: "pl-3",
  /** Indented under a block head, one 12px step in, like a member person
   *  row (`sidebarPersonRow.padChild`). */
  depthChild: "pl-6",
  /** The person row's own height, overriding the glyph row's on both
   *  elements (tailwind-merge keeps the later height). */
  personHeight: sidebarPersonRow.height,
  personIcon: `${sidebarPersonRow.iconBox} ${sidebarPersonRow.iconGap}`,
  /**
   * The text column, stretched to the row's full height so its hairline runs
   * along the row's foot from the text's left edge, the way a message list
   * separates threads without cutting under the portraits. `font-variation-
   * settings: normal` undoes the row's inherited `"wght" 510`, which would
   * otherwise override both lines' weights and make the name and the line
   * read as one weight.
   */
  personText:
    "flex min-w-0 flex-1 flex-col justify-center self-stretch border-b border-line [font-variation-settings:normal] group-hover/row:border-transparent",
  /** A person row without the hairline: the selected one (drawing it would
   *  cut a line through the pill) and the account row that ends the rail,
   *  which separates nothing from anything below it. */
  personTextBare: "border-transparent",
  /** The pill spans the row's full width: a person row carries its own 12px
   *  padding instead of the glyph rows' 6px inset. */
  personFill: "before:inset-x-0",
  personPadBlock: sidebarPersonRow.padBlock,
  personPadChild: sidebarPersonRow.padChild,
  /** One line of a person row: its text truncates, its end item never. */
  personLine: "flex min-w-0 items-start gap-2",
  personName: `min-w-0 truncate ${sidebarPersonRow.name}`,
  /** Up to two lines, then an ellipsis: room for a task title to read whole,
   *  the way a message list previews a message. */
  personRole: `min-w-0 flex-1 line-clamp-2 break-words ${sidebarPersonRow.role}`,
  personBadge: "flex shrink-0 items-center",
  draggable: "cursor-grab active:cursor-grabbing",
  icon: `${sidebarIconBox} ${sidebarIconGap}`,
  /**
   * Label + disclosure mark, as one phrase. They sit 4px apart rather than the
   * row's 6px icon gap, because a triangle a full gap away from the words reads as a
   * separate control instead of as the words' own state.
   */
  labelGroup: "flex min-w-0 items-center gap-1",
  label: "min-w-0 truncate",
  spacer: "min-w-0 flex-1",
  trailing: `${sidebarTrailingGap} flex shrink-0 items-center`,
  /**
   * The disclosure triangle: a 16px box, Linear's own, holding the 5x7 mark the
   * path draws. It was 12px and washed out at `ink-muted/60`, which put a pale
   * speck next to the words instead of a state you can read at a glance.
   *
   * `ink-muted` is deliberately ONE step short of the label (`hover-text`): the
   * triangle states the row's state, it does not name the row, so it must be
   * unmistakable at rest and still read as quieter than the words it follows.
   * Hover strengthens it to full ink, as it always did.
   */
  caret:
    "size-4 shrink-0 fill-current text-ink-muted transition-transform duration-150 group-hover/row:text-ink motion-reduce:transition-none",
} as const;

/**
 * A control on the rail's top line: the collapse toggle and the host's header
 * actions beside it (search, create). One class, so the line reads as one set
 * of buttons rather than a toggle with lookalikes parked next to it.
 */
export const sidebarHeaderControlClasses =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover data-[state=open]:text-ink";

/**
 * A person row's hairline stays out of the way of the pill beside it, the way
 * a message list drops the separators around its selection. The row's OWN
 * line hides under its hover and selection (`personText`); these hide the
 * line of the row ABOVE. The pill is translucent, so it cannot simply paint
 * over that line: a pill a pixel under a visible line is exactly the
 * imprecise edge this exists to prevent.
 *
 * `sidebarRowNeighbour` goes on every `[data-sidebar-row]` wrapper, the one
 * element per row in a run of siblings. `sidebarPinnedNeighbour` goes on the
 * pinned run, whose next row is the first of the scrolling list beside it;
 * with no such row, the run ends the rail without a line, as the list does.
 */
export const sidebarRowNeighbour =
  "[&:has(+*:hover)_[data-person-text]]:border-transparent [&:has(+*_[aria-current=page])_[data-person-text]]:border-transparent";
/** On the list: its last row separates nothing from anything below it, so
 *  it ends the list without a line, the way a message list ends. */
export const sidebarListEnd =
  "[&>[data-sidebar-row]:last-of-type_[data-person-text]]:border-transparent";
export const sidebarPinnedNeighbour =
  "[&:has(+*_[data-sidebar-root-list]>[data-sidebar-row]:first-of-type:hover)_[data-sidebar-row]:last-child_[data-person-text]]:border-transparent [&:has(+*_[data-sidebar-root-list]>[data-sidebar-row]:first-of-type_[aria-current=page])_[data-sidebar-row]:last-child_[data-person-text]]:border-transparent [&:not(:has(+*_[data-sidebar-row]))_[data-sidebar-row]:last-child_[data-person-text]]:border-transparent";

/**
 * A row's trailing control: the "..." menu on a group. A SIBLING of the row
 * button, never a child, because a button may not nest inside a button.
 *
 * Always rendered, muted at rest, strengthening on hover / focus / open.
 * Houston forbids hover-GATED affordances: a control that only exists under the
 * cursor is unreachable by touch and invisible to anyone scanning the rail.
 *
 * `relative` for one reason only: the row's pill is an absolutely positioned
 * `::before`, and a static sibling would paint underneath it.
 *
 * Exported from the package because `app/` mounts its own menus into a row's
 * affordance slot, and a hand-copied class string is how two triggers on the
 * same row end up looking like two different controls.
 */
export const sidebarRowAffordanceClasses = `relative ${sidebarRowEndMargin} flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted/60 transition-[background-color,color] duration-100 hover:bg-hover hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover data-[state=open]:text-ink`;

/**
 * The one piece of agent-row anatomy the shared row does NOT own: the badge an
 * agent wears in the COLLAPSED icon rail, which is a different anatomy (a 36px
 * square with a corner badge), not a narrower version of this one.
 */
export const sidebarCollapsedItemClasses = {
  trailing:
    "pointer-events-none absolute top-0 -right-1 flex scale-75 items-center justify-center",
} as const;
