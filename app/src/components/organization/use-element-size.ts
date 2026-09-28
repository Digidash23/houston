import { type RefObject, useLayoutEffect, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * The content box of `ref`'s element, kept current as it resizes. Measured
 * in a layout effect, so the first real size lands before the first paint
 * and a drawing sized from it never flashes at the zero default.
 */
export function useElementSize(
  ref: RefObject<HTMLElement | null>,
): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
