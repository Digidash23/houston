import { useEffect, useRef } from "react";
import { useOrgNav } from "./org-nav-store";

/**
 * The person People was opened on (a face on the org chart), brought into
 * view once it is drawn. The list marks each row with `data-person`; the
 * focus lasts while People is up and is let go as it unmounts, so coming
 * back to People later lands on the plain roster.
 */
export function usePersonFocus() {
  const focused = useOrgNav((store) => store.focusedPerson);
  const clear = useOrgNav((store) => store.clearFocusedPerson);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!focused) return;
    const rows =
      listRef.current?.querySelectorAll<HTMLElement>("[data-person]");
    const row = [...(rows ?? [])].find((el) => el.dataset.person === focused);
    row?.scrollIntoView({ block: "center" });
  }, [focused]);

  useEffect(() => clear, [clear]);

  return { focused, listRef };
}
