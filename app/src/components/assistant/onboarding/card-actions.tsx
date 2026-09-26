import type { ReactNode } from "react";

/** A card's footer actions: stacked full width for the thumb on a phone (the
 *  first action lowest, nearest the thumb), one row on desktop. */
export function CardActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-col-reverse gap-2 md:w-auto md:flex-row md:items-center">
      {children}
    </div>
  );
}

/** Sizing for a button inside {@link CardActions}: thumb-sized on a phone. */
export const CARD_ACTION_CLASS = "h-11 w-full rounded-full md:h-9 md:w-auto";

/** The card's primary action, listed FIRST in {@link CardActions}: lowest on
 *  a phone, last in the desktop row, and first to take focus from the
 *  keyboard. */
export const CARD_PRIMARY_ACTION_CLASS = `${CARD_ACTION_CLASS} md:order-last`;
