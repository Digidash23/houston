import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Spinner,
} from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import type { ContextSlotState } from "./context-slot-state";

/**
 * What a context editor shows before it can: a spinner while the read is on
 * its way, and the honest reason when there is no AI Employee to keep the
 * text with yet.
 */
export function ContextSlotWaiting({
  state,
}: {
  state: Exclude<ContextSlotState, "ready">;
}) {
  const { t } = useTranslation("context");
  if (state === "noAgent")
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("editor.noAgent.title")}</EmptyTitle>
          <EmptyDescription>{t("editor.noAgent.body")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner className="size-5" />
    </div>
  );
}
