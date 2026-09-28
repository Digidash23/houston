import { UserInteractionAnswersMessage } from "@houston-ai/chat";
import { Button } from "@houston-ai/core";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReceiptCopy } from "./use-script-copy";

/**
 * The person's answer, as the same receipt a real answered question leaves
 * in the chat. The latest answer carries "Change answer" beneath it, always
 * visible, which asks its question again.
 */
export function ManagerReceipt({
  copy,
  onChange,
}: {
  copy: ReceiptCopy;
  /** Present only on the latest answer, while it can still change. */
  onChange?: () => void;
}) {
  const { t } = useTranslation("assistant");
  const receipt = (
    <UserInteractionAnswersMessage
      payload={{
        lines: [
          copy.question === undefined
            ? { answer: copy.answer }
            : { question: copy.question, answer: copy.answer },
        ],
      }}
    />
  );
  if (!onChange) return receipt;
  return (
    <div className="flex flex-col items-end gap-1">
      {receipt}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="manager-change-answer"
        className="h-11 gap-1.5 rounded-full text-ink-muted md:h-8"
        onClick={onChange}
      >
        <Pencil className="size-4" aria-hidden="true" />
        {t("onboarding.changeAnswer")}
      </Button>
    </div>
  );
}
