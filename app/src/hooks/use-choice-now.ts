import type { BillingChoice } from "@houston/engine-adapter";
import { nextChoiceDeadline } from "@houston/sdk";
import { useEffect, useState } from "react";

/**
 * The time a choice surface renders against, re-read when the change window
 * or the cutover passes so an open session never outlives either.
 */
export function useChoiceNow(choice: BillingChoice | null | undefined): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    // Counted from the live clock each time, never from a stale `now`, and
    // re-armed after each deadline (setTimeout caps at 2^31-1 ms).
    const arm = () => {
      const wait = nextChoiceDeadline(choice, Date.now());
      if (wait === null) return;
      id = setTimeout(
        () => {
          setNow(Date.now());
          arm();
        },
        Math.min(wait, 2 ** 31 - 1),
      );
    };
    // New data can carry a deadline that has already passed.
    setNow(Date.now());
    arm();
    return () => clearTimeout(id);
  }, [choice]);
  return now;
}
