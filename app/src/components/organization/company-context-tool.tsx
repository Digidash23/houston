import { Sheet } from "@houston-ai/core";
import { type ReactNode, useState } from "react";
import { PageHeaderTools } from "../shell/page-header/page-header-tools";
import {
  CompanyContextSheetContent,
  CompanyContextTrigger,
} from "./company-context-sheet";

/**
 * Company context: the standing knowledge every agent in this workspace starts
 * a turn with. It is admin-owned org-wide copy, so it opens from the Admin
 * header, in every space and over whichever section is showing; the per-user
 * half of the same context lives with the user (Settings > About me).
 *
 * Only the pill rides {@link PageHeaderTools}, whose subtree remounts when the
 * strip crosses its threshold. The sheet's root and content sit above it, so
 * an open editor keeps its one instance, and whatever was typed into it,
 * across that crossing. `onOpened` reports each opening.
 */
export function CompanyContextTool({
  onOpened,
  children,
}: {
  onOpened: () => void;
  /** The editor, mounted only while the sheet is open. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => {
    if (next && !open) onOpened();
    setOpen(next);
  };
  return (
    <Sheet open={open} onOpenChange={change}>
      <PageHeaderTools>
        {(inStrip) => (
          <div
            className={
              inStrip
                ? "flex items-center"
                : "flex shrink-0 justify-end px-5 pb-2"
            }
          >
            <CompanyContextTrigger />
          </div>
        )}
      </PageHeaderTools>
      <CompanyContextSheetContent>{children}</CompanyContextSheetContent>
    </Sheet>
  );
}
