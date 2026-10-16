"use client";

import { Button, cn, Kbd } from "@houston-ai/core";
import { ChatInputAttachButton } from "./chat-input-attach-button";
import { ChatInputAttachments } from "./chat-input-attachments";
import { FreeTextRow } from "./interaction-free-text-row";
import type { CardAttach } from "./use-card-attachments";

/** The question's fixed answer row — the free-text escape field with the
 *  card-wide decline at its right ("type here, or skip" in one glance) —
 *  handed to the modal's `trailing` slot so it never scrolls away with a long
 *  option list. `hideFreeText` drops the field and leaves the skip button
 *  right-aligned alone (beside a bare "+" when the card takes attachments).
 *
 *  With `attach`, the panel's attached files show as the composer's chips
 *  above the row: the card replaced the composer, so this is the one place
 *  they are visible, and they leave with whichever answer completes the card
 *  (a typed one or a picked option). */
export function QuestionAnswerRow({
  disabled,
  draft,
  placeholder,
  sendLabel,
  hideFreeText = false,
  attach,
  fileAnswer,
  skip,
  onDraftChange,
  onSubmit,
}: {
  disabled: boolean;
  draft: string;
  placeholder: string;
  sendLabel: string;
  hideFreeText?: boolean;
  attach?: CardAttach | null;
  fileAnswer: boolean;
  skip: {
    label: string;
    escLabel: string;
    onSkip: () => void;
    disabled: boolean;
  };
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      {attach && (
        <div className={cn(attach.files.length > 0 && "mt-3")}>
          <ChatInputAttachments
            files={attach.files}
            fileInputRef={attach.fileInputRef}
            folderCountLabel={attach.labels?.folderFileCount}
            folderInputRef={attach.folderInputRef}
            onFileChange={attach.handleFileChange}
            onRemoveFiles={attach.removeFiles}
            removeLabel={attach.labels?.removeAttachment}
          />
        </div>
      )}
      <div
        className={cn(
          "flex items-center gap-2",
          hideFreeText && (attach ? "justify-between" : "justify-end"),
        )}
      >
        {!hideFreeText && (
          <div className="min-w-0 flex-1">
            <FreeTextRow
              attach={attach}
              disabled={disabled}
              fileAnswer={fileAnswer}
              onChange={onDraftChange}
              onSubmit={onSubmit}
              placeholder={placeholder}
              sendLabel={sendLabel}
              value={draft}
            />
          </div>
        )}
        {hideFreeText && attach && (
          <div className="mt-1.5">
            <ChatInputAttachButton
              ariaLabel={attach.labels?.attachFiles}
              disabled={disabled}
              onOpenFilePicker={attach.openFilePicker}
              onOpenFolderPicker={attach.openFolderPicker}
            />
          </div>
        )}
        <Button
          className="mt-1.5 gap-1.5 text-ink-muted"
          disabled={skip.disabled}
          onClick={skip.onSkip}
          size="sm"
          type="button"
          variant="outline"
        >
          {skip.label}
          <Kbd>{skip.escLabel}</Kbd>
        </Button>
      </div>
    </>
  );
}
