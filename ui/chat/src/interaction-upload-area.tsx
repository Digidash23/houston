"use client";

import { cn } from "@houston-ai/core";
import { Plus } from "lucide-react";
import type { DragEvent, DragEventHandler } from "react";
import { ChatInputAttachments } from "./chat-input-attachments";
import type { CardAttach } from "./use-card-attachments";
import { useFileDropZone } from "./use-file-drop-zone";

/**
 * The upload area of a question answered with a file (`wantsFiles`): one large
 * button that opens the file picker and takes dropped files, with the panel's
 * attached files as the composer's chips right below it. It writes the same
 * panel list as the answer row's paste and the panel-wide drop, so the files
 * leave with whichever answer completes the card.
 */
export function InteractionUploadArea({
  attach,
  label,
  disabled,
}: {
  attach: CardAttach;
  label: string;
  disabled: boolean;
}) {
  const { isDraggingOver, dropProps } = useFileDropZone(
    attach.addFiles,
    attach.onDropError,
  );
  // A file drag over the box stops here, so the panel's frosted drop overlay
  // steps aside (its depth count sees the pointer leave) and the box itself
  // shows where the files land.
  const own =
    (handler: DragEventHandler): DragEventHandler =>
    (e: DragEvent) => {
      handler(e);
      if (e.dataTransfer.types.includes("Files")) e.stopPropagation();
    };
  const drop = disabled
    ? {}
    : {
        onDragEnter: own(dropProps.onDragEnter),
        onDragOver: own(dropProps.onDragOver),
        onDragLeave: own(dropProps.onDragLeave),
        onDrop: own(dropProps.onDrop),
      };

  return (
    <div className="flex flex-col gap-2">
      <button
        className={cn(
          "group relative flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-line-input border-dashed px-4 py-6 outline-none md:py-8",
          "transition-[scale] duration-(--ht-duration-press) ease-out active:scale-[0.98] motion-reduce:transition-none",
          "focus-visible:ring-[3px] focus-visible:ring-focus/50",
          "disabled:pointer-events-none disabled:opacity-50 data-[dragging]:border-focus",
        )}
        data-dragging={isDraggingOver || undefined}
        disabled={disabled}
        onClick={attach.openFilePicker}
        type="button"
        {...drop}
      >
        {/* The wash is its own layer so only its opacity animates. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] bg-hover opacity-0 transition-opacity duration-(--ht-duration-fast) ease-(--ht-easing-entrance) group-hover:opacity-60 group-data-[dragging]:opacity-100"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none relative flex size-10 items-center justify-center rounded-full bg-chip text-ink transition-transform duration-(--ht-duration-fast) ease-(--ht-easing-entrance) group-data-[dragging]:scale-110 motion-reduce:transition-none"
        >
          <Plus className="size-5" />
        </span>
        <span className="pointer-events-none relative font-medium text-ink text-sm">
          {label}
        </span>
      </button>
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
  );
}
