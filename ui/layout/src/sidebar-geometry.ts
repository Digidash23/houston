/**
 * The rail's row anatomy, defined ONCE.
 *
 * EVERY interactive line in the sidebar's list is the same row: each group's
 * header, and each person. A person row (see {@link sidebarPersonRow}) is the
 * one deliberate variation: a bigger portrait and a second line, spaced like a
 * message list. Rows differ only in what they point at and how far their
 * glyph is indented. If any of them drifts in height, indent, glyph column or
 * type size, the rail stops reading as one list and starts reading as several
 * stacked ones. So every value lives here and nowhere else, and
 * {@link SidebarRowButton} is the only component that spends them.
 *
 * Six invariants keep every row on the same ladder:
 *
 * 1. **Height is FIXED per anatomy** (`h-7`, 28px; a person row `h-16`, 64px).
 *    No hover, active, focus, badge or missing-role state may change it — a
 *    rail that reflows under the cursor is the single most obvious tell of a
 *    hand-built list.
 * 2. **The paint is a LAYER, the content sits on top of it.** Hover and active
 *    are drawn on the row's own `::before` — an inset, rounded pill (see
 *    {@link sidebarRowFill}) — never on the element that carries the geometry.
 *    That split is the whole reason the pill can be inset without dragging the
 *    glyph column 6px to the right with it: the indent is spent inside a
 *    full-width button that the paint knows nothing about, so the pills form
 *    one clean column and hierarchy stays a matter of indent, never of a ragged
 *    left edge.
 * 3. **Colour is never pinned on the glyph.** A row's icon inherits its label's
 *    colour, so an active row brightens as one object rather than as a label
 *    with a stale grey mark beside it.
 * 4. **ONE weight for the rail's lines.** Every glyph row is set at 510, the
 *    notch past
 *    medium that Linear's rails use. Weight is therefore never a variable: not
 *    of depth, not of state, so nothing re-measures or reflows on click, and
 *    hierarchy is carried entirely by indent and colour. See
 *    `font-weight-510` in `@houston-ai/core`'s globals for why 510 is spelled
 *    the way it is. A person row's NAME is the exception: it is set semibold
 *    at the same 13px, because it names someone rather than somewhere.
 * 5. **One type size for the rows.** Every row is 13px; a person row's second
 *    line is the one 12px exception. See {@link sidebarRowType}.
 * 6. **One horizontal inset for every run of rows.** See
 *    {@link sidebarRailInset}.
 */

export const sidebarClasses = {
  itemsList: "w-0 min-w-full space-y-px pb-2",
  /** Pinned rows lead the list on its own 1px rhythm, so the first team
   *  block follows them as the next row rather than as a new section. */
  pinnedList: "w-0 min-w-full space-y-px pb-px",
} as const;

/**
 * The ONE horizontal inset the rail's contents sit on: the pinned rows, the
 * scrolling list and the account row at the foot, and nothing else in the
 * rail may add another. Spending the value from one export is what keeps the
 * three on one edge: a consumer cannot double it without doubling this.
 */
export const sidebarRailInset = "px-2";

/** Every row in the rail is exactly this tall. See invariant 1. */
export const sidebarRowHeight = "h-7";

/**
 * Team marks size themselves at 14px (`glyph`), including inside a colour
 * wrapper. Bare Lucide marks and the Houston logo use the 16px `slot` rule.
 */
export const sidebarMarkSize = {
  glyph: "size-3.5",
  slot: "[&>img]:size-4 [&>svg]:size-4",
} as const;

/**
 * The shared 20px glyph column holds a 16px Lucide mark or a 14px team mark.
 * Team wrappers preserve their own size; bare destination marks inherit the
 * slot rule on both rail layouts.
 */
export const sidebarIconBox = `flex size-5 shrink-0 items-center justify-center ${sidebarMarkSize.slot}`;

/** The glyph column's diameter, for a mark sized off the column rather than
 *  off its contents (a folded team's running ring). */
export const sidebarGlyphDiameter = 20;

/** A running ring clears the mark it circles by 2px a side. */
export const sidebarRingClearance = 4;

/**
 * The person row: an AI Employee in the expanded rail, spaced like a message
 * list rather than a menu. Its avatar is a real portrait slot (people may give
 * their employees their own pictures), 40px, with the name above a line that
 * may run to two. The row is 64px so the avatar sits on even 12px padding and
 * the name plus two 16px lines (52px) fit with air to spare; a row with less
 * to say keeps the height and centres what it has. The text never grows: the
 * name keeps the rail's 13px and gains weight, the line is 12px and muted.
 */
export const sidebarPersonRow = {
  height: "h-16",
  avatarDiameter: 40,
  iconBox: "flex size-10 shrink-0 items-center justify-center",
  /** Avatar edge to text: the portrait fills its box, so this IS the optical
   *  gap, a step wider than a glyph row's because the mark is wider. */
  iconGap: "mr-2.5",
  name: "text-[13px] leading-5 font-semibold text-ink",
  role: "text-xs leading-4 font-normal text-ink-muted",
  /** Inside the pill, 12px from each edge: the same 12px the portrait keeps
   *  from the top and bottom, so the portrait sits on even padding all round.
   *  A grouped row steps in by the rail's usual 12px. */
  padBlock: "pl-3 pr-3",
  padChild: "pl-6 pr-3",
} as const;

/**
 * An AI Employee on the COLLAPSED icon rail: a 36px square, not a narrower
 * person row. Its avatar is 24px so the avatar AND its running ring (28px,
 * {@link sidebarRingClearance}) sit inside the square with 4px of air a side;
 * the expanded rail's 32px portrait would put the ring on the square's edge.
 * The hover flyout beside it is a full person row and keeps the portrait.
 */
export const sidebarCollapsedItem = {
  square: "size-9",
  avatarDiameter: 24,
} as const;

/**
 * The add row closing the list: a shortcut, not a member, so it is shorter
 * than a person row (40px, the portrait's own height) while keeping the
 * person row's columns: its Plus centred in the portrait column, its label
 * on the names' left edge.
 */
export const sidebarAddRow = {
  height: "h-10",
} as const;

/**
 * The add row's empty seat: the portrait slot of whichever rail it is on,
 * holding a bare Plus, so the glyph centres on the avatars above it. The Plus
 * is the 16px standard glyph in both.
 */
export const sidebarSeat = {
  expanded: { diameter: sidebarPersonRow.avatarDiameter, glyph: 16 },
  collapsed: { diameter: sidebarCollapsedItem.avatarDiameter, glyph: 16 },
} as const;

/**
 * A row has TWO horizontal gaps and they want opposite things, which is why
 * there is no single `gap` on the row. One `gap` would set both at once:
 * tightening the icon side drags the trailing side in with it, and the badge
 * and the "..." end up crowding the row's right edge.
 *
 * **`ICON_GAP` — glyph column to label. TIGHT (6px).** What the eye measures is
 * glyph EDGE to first letter, which is this margin PLUS the slack the mark
 * leaves inside the 20px box: a mark that fills it leaves 0, a 16px Lucide
 * mark leaves 2px a side, and a 14px team mark leaves 3px a side. 6px puts the
 * optical distance at 6-9px, Linear's own range; 8px would put it at 8-11px and a label would read as
 * drifting away from its own icon.
 *
 * **`TRAILING_GAP` — label to the badge on its right. COMFORTABLE (8px).** A
 * count or a status dot is a separate object from the name, not part of the
 * phrase, so it needs air the icon does not: the icon and the label are ONE
 * thing being read left to right.
 *
 * Both spent once, here, so a nav destination, a team header, an agent, the add
 * row and the footer row cannot drift into different gaps.
 */
export const sidebarIconGap = "mr-1.5";
export const sidebarTrailingGap = "ml-2";

/**
 * How far the row's last thing stops short of the row's edge — 8px, which is
 * 2px INSIDE the pill ({@link sidebarRowFill} insets the paint by 6px). Two
 * spellings of the same number because they sit on different elements: the
 * button pads its own right edge, and the "..." affordance beside it is a
 * SIBLING and has to carry a margin instead. At 4px both overhung the pill they
 * sit in, which is what made the "..." look jammed against the edge.
 */
export const sidebarRowEndPad = "pr-2";
export const sidebarRowEndMargin = "mr-2";

/**
 * The rail's row type: 13px at Linear's 510 (invariant 4), worn by every row
 * so the rail reads as one list.
 *
 * Line-heights are set explicitly and both are shorter than the 28px row, so
 * the label sits optically centred in the box and descenders survive the
 * label's `overflow: hidden` truncation (a `leading-none` label clips the tail
 * of a "g").
 */
export const sidebarRowType = {
  item: "text-[13px] leading-5 font-weight-510",
} as const;
