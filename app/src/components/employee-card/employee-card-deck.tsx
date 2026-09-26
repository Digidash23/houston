import { durationMs, easing } from "@houston/design-tokens";
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/** The gap between two cards arriving. */
const STAGGER_S = 0.08;
/** Past the fifth card the rest arrive together, so a long roster never
 *  keeps the person waiting on its last row. */
const STAGGER_CAP = 5;

/**
 * A team of employee cards, sized by the room the deck has rather than the
 * window: three across once it is 1024px wide (the new-workspace dialog on a
 * desktop), more wrapping into rows of three; below that, one badge per row at
 * the full width, which is a phone and the AI Manager's chat. A row of three
 * keeps every card as tall as the tallest.
 *
 * The cards arrive in order like new hires walking in: the welcome is a
 * designated moment, so each rises over `duration.elegant` on the entrance
 * curve. With reduced motion they only fade.
 */
export function EmployeeCardDeck({
  items,
}: {
  items: readonly { key: string; card: ReactNode }[];
}) {
  const reduce = useReducedMotion() ?? false;
  return (
    <div className="@container">
      <ul className="grid grid-cols-1 gap-3 @5xl:grid-cols-3 @5xl:gap-4">
        {items.map((item, index) => (
          <motion.li
            key={item.key}
            className="flex min-w-0"
            initial={{
              opacity: 0,
              y: reduce ? 0 : 12,
              scale: reduce ? 1 : 0.98,
            }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: durationMs.elegant / 1000,
              ease: easing.entrance,
              delay: Math.min(index, STAGGER_CAP) * STAGGER_S,
            }}
          >
            {item.card}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Takes the person to the name field of the `index`-th card under `root`: its
 * badge glides into view (at once under reduced motion), then the field takes
 * focus.
 */
export function focusEmployeeName(
  root: HTMLElement | null,
  index: number,
  reduce: boolean,
): void {
  const field = root?.querySelectorAll<HTMLInputElement>(
    "[data-employee-name]",
  )[index];
  if (!field) return;
  (field.closest("fieldset") ?? field).scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "nearest",
  });
  field.focus({ preventScroll: true });
}
