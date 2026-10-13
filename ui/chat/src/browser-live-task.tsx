"use client";

import { useLayoutEffect, useRef, useState } from "react";

export interface BrowserLiveTaskProps {
  task: string;
  showMore: string;
  showLess: string;
}

/**
 * The agent's instruction, never cut mid-sentence without a way back: a
 * phone clamps it to three lines and offers Show more only when it really
 * overflows; desktop has the room and shows it whole.
 */
export function BrowserLiveTask({
  task,
  showMore,
  showLess,
}: BrowserLiveTaskProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Measured while clamped; once expanded the toggle must stay to fold.
      if (!el.dataset.expanded)
        setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-w-0">
      <p
        className={`text-sm font-medium text-pretty text-ink md:line-clamp-none ${expanded ? "" : "line-clamp-3"}`}
        data-expanded={expanded || undefined}
        ref={ref}
      >
        {task}
      </p>
      {overflows || expanded ? (
        <button
          aria-expanded={expanded}
          className="relative -ml-1 mt-0.5 rounded-md px-1 text-xs font-medium text-ink-muted outline-none transition-transform duration-150 ease-out after:absolute after:-inset-2 hover:text-ink focus-visible:ring-[3px] focus-visible:ring-focus/50 active:scale-[0.97] md:hidden"
          onClick={() => setExpanded((open) => !open)}
          type="button"
        >
          {expanded ? showLess : showMore}
        </button>
      ) : null}
    </div>
  );
}
