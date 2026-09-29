import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@houston-ai/core";
import { sidebarSheetRowClasses } from "@houston-ai/layout";
import type { ReactNode } from "react";
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
 * The More card's account row: the person's portrait and "Your account",
 * opening the same account menu as the portrait in the rail's foot
 * (`sidebar-account-menu.tsx`), upward, since the row sits low in the card.
 */
export function MobileAccountRow(props: {
  label: string;
  avatar: ReactNode;
  menu: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="more-account"
          className={sidebarSheetRowClasses}
        >
          <RowFace icon={props.avatar} label={props.label} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        collisionPadding={8}
        className="w-60"
      >
        {props.menu}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
