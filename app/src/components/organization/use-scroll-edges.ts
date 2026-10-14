import { useCallback, useRef, useState } from "react";
import {
  NO_EDGES,
  type ScrollEdges,
  scrollEdges,
} from "./org-chart-scroll-edges";

/**
 * A callback ref for a sideways scroller and which of its sides hide
 * content, kept current as it scrolls and resizes. It opens wherever the
 * browser puts it, the left edge, so a chart wider than the screen shows
 * its first columns (the owners) rather than a clipped middle. Admin is
 * kept alive, so while it is hidden every measure reads 0 and no side is
 * reported; the ResizeObserver catches the first real size.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const update = () =>
      setEdges((prev) => {
        const next = scrollEdges(el);
        return prev.start === next.start && prev.end === next.end ? prev : next;
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const watcher =
      typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    watcher?.observe(el);
    if (el.firstElementChild) watcher?.observe(el.firstElementChild);
    cleanup.current = () => {
      el.removeEventListener("scroll", update);
      watcher?.disconnect();
    };
  }, []);
  return { ref, edges };
}
