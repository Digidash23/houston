import {
  Button,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  useIsMobile,
} from "@houston-ai/core";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * The Admin header's Company context pill. It lives in the header's tools
 * slot, which remounts it whenever the strip crosses its threshold, so it
 * holds no state: the open state is its `Sheet` root's, above the slot.
 */
export function CompanyContextTrigger() {
  const { t } = useTranslation("teams");
  return (
    <SheetTrigger asChild>
      <Button variant="outline" size="sm" data-company-context-trigger="">
        <BookOpen aria-hidden />
        {t("org.companyContext.title")}
      </Button>
    </SheetTrigger>
  );
}

/**
 * The sheet the pill opens: from the right on the desktop, from the bottom on
 * the phone, where a side panel would leave no room to write. Its body
 * mounts only while it is open, so the editor's read waits for someone to
 * ask, and closing it unmounts the editor, which flushes a pending save
 * (`use-context-editor-save` saves on unmount).
 */
export function CompanyContextSheetContent({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useTranslation("teams");
  const isMobile = useIsMobile();
  return (
    <SheetContent
      side={isMobile ? "bottom" : "right"}
      data-testid="company-context-sheet"
      className={
        isMobile
          ? "h-dvh max-h-[80dvh] gap-0 rounded-t-2xl pb-safe"
          : "gap-0 sm:max-w-2xl"
      }
    >
      <SheetHeader className="pr-12">
        <SheetTitle>{t("org.companyContext.title")}</SheetTitle>
        <SheetDescription>
          {t("org.companyContext.description")}
        </SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 px-4 pb-4">{children}</div>
    </SheetContent>
  );
}
