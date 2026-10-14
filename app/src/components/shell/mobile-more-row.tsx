import { sidebarSheetRowClasses } from "@houston-ai/layout";
import { ChevronRight } from "lucide-react";
import type { ReactNode, Ref } from "react";
import type { MenuRow } from "./menu-row";

function RowFace(props: { icon: ReactNode; label: string }) {
  return (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center text-ink-muted">
        {props.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </>
  );
}

/**
 * One destination in the phone's More menu: a sheet row
 * (`sidebarSheetRowClasses`) like the switcher and the connect rows above it,
 * so the card has one left edge and one type size. It spreads the rail's own
 * `dataAttrs`, so the lessons' anchors resolve to THIS element on the phone
 * exactly as they resolve to the rail's control on the desktop — one
 * vocabulary, two renderings.
 */
export function MobileMoreRowButton({ row }: { row: MenuRow }) {
  return (
    <button
      type="button"
      onClick={row.onClick}
      className={sidebarSheetRowClasses}
      {...row.dataAttrs}
    >
      <RowFace icon={row.icon} label={row.label} />
    </button>
  );
}

/**
 * The More card's account row: the person's portrait and "Your account". It
 * drills into the card's account page (`mobile-more-account.tsx`), the
 * phone's form of the rail's account menu, so the chevron says it goes
 * deeper rather than somewhere else.
 */
export function MobileAccountRow(props: {
  label: string;
  avatar: ReactNode;
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={props.ref}
      type="button"
      data-testid="more-account"
      onClick={props.onOpen}
      className={sidebarSheetRowClasses}
    >
      <RowFace icon={props.avatar} label={props.label} />
      <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
    </button>
  );
}
