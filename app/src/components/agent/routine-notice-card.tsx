/**
 * The frame every routine-screen notice wears (the plan-skip notice, the
 * auto-pause banner), so they read as one family. The status glyph owns its
 * own column: the title and the body share one left edge however either
 * wraps, which a dot inside the title line could not do.
 *
 * `card` floats on the routine screen; `inline` sits inside a dialog that
 * already frames it, as a recessed panel rather than a card in a card.
 */

import { cn } from "@houston-ai/core";
import { CircleAlert, Info, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export type RoutineNoticeTone = "warning" | "info";

const GLYPH: Record<RoutineNoticeTone, { icon: LucideIcon; tone: string }> = {
  warning: { icon: CircleAlert, tone: "text-warning-ink" },
  info: { icon: Info, tone: "text-ink-muted" },
};

interface Props extends Omit<ComponentProps<"div">, "title"> {
  tone: RoutineNoticeTone;
  heading: string;
  body: string;
  actions?: ReactNode;
  surface?: "card" | "inline";
  /** `row` puts the actions beside the copy from the desktop edge up;
   *  `stacked` keeps them under it at every width. */
  layout?: "row" | "stacked";
}

export function RoutineNoticeCard({
  tone,
  heading,
  body,
  actions,
  surface = "card",
  layout = "row",
  className,
  ...rest
}: Props) {
  const { icon: Icon, tone: glyphTone } = GLYPH[tone];
  return (
    <div
      role="status"
      {...rest}
      className={cn(
        "grid w-full grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 rounded-xl px-4 py-3.5 text-sm",
        // It lands after its query resolves: a short fade-in softens the
        // content below moving down. Opacity and transform only.
        "duration-200 ease-out animate-in fade-in-0 slide-in-from-top-1 motion-reduce:animate-none",
        surface === "card" ? "bg-card ht-hairline" : "bg-chip-subtle",
        layout === "row" && "md:grid-cols-[1rem_minmax(0,1fr)_auto]",
        className,
      )}
    >
      {/* mt-0.5 centres the 16px glyph on text-sm's 20px first line. */}
      <Icon aria-hidden className={cn("mt-0.5 size-4", glyphTone)} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-pretty font-medium text-ink">{heading}</p>
        <p className="text-pretty text-ink-muted">{body}</p>
      </div>
      {actions && (
        <div
          className={cn(
            "col-start-2 flex flex-wrap gap-2",
            layout === "row" &&
              "md:col-start-3 md:row-start-1 md:self-center md:justify-end",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
