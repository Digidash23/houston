/**
 * The employee card as plain data: where it stands, how that reads on its
 * foot, and how its palette's keys move. Testable without rendering.
 */

/**
 * Where a card is placed. `grid` is one of a team (`EmployeeCardDeck` gives
 * it its width), `solo` one card centred on its own, never wider than 672px.
 */
export type EmployeeCardLayout = "grid" | "solo";

/** Where a card stands: a draft not hired yet, then its hire's progress. */
export type EmployeeCardStatus = "draft" | "joining" | "hired" | "failed";

/** The mark in front of the status label on the card's foot. */
export type EmployeeStatusMark = null | "spinner" | "successDot" | "alert";

export interface EmployeeStatusView {
  mark: EmployeeStatusMark;
  /** The portrait fades while the hire is on its way. */
  dimPortrait: boolean;
  /** Retry (and Remove, where allowed) sit on the foot. */
  offersActions: boolean;
}

const STATUS_VIEWS: Record<EmployeeCardStatus, EmployeeStatusView> = {
  draft: { mark: null, dimPortrait: false, offersActions: false },
  joining: { mark: "spinner", dimPortrait: true, offersActions: false },
  hired: { mark: "successDot", dimPortrait: false, offersActions: false },
  failed: { mark: "alert", dimPortrait: false, offersActions: true },
};

export function employeeStatusView(
  status: EmployeeCardStatus,
): EmployeeStatusView {
  return STATUS_VIEWS[status];
}

/**
 * How many swatches the palette lays out per row, from each swatch's top edge
 * in order: the run that shares the first one's row. The card's own width
 * decides the columns (a container query), so the keys read them back from
 * the layout rather than assume them.
 */
export function paletteColumns(tops: readonly number[]): number {
  const row = tops.findIndex((top) => top !== tops[0]);
  return row === -1 ? tops.length : row;
}

/**
 * The swatch an arrow key moves the palette's selection to, or null for any
 * other key. Left and Right step along the row, Up and Down jump a row of
 * `columns`, Home and End go to either end; the selection wraps around.
 */
export function paletteKeyStep(
  key: string,
  index: number,
  count: number,
  columns: number,
): number | null {
  const wrap = (next: number) => (next + count) % count;
  switch (key) {
    case "ArrowRight":
      return wrap(index + 1);
    case "ArrowLeft":
      return wrap(index - 1);
    case "ArrowDown":
      return wrap(index + columns);
    case "ArrowUp":
      return wrap(index - columns);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
