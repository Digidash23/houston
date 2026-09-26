import { TooManyAttachmentFilesError } from "@houston-ai/core";
import { useCallback } from "react";
import type { ChatPanelProps } from "./chat-panel-types";
import type { MessageMention } from "./types";
import {
  DEFAULT_TOO_MANY_FILES_NOTICE,
  useAttachmentIntake,
} from "./use-attachment-intake";
import { useControllable, useFileDropZone } from "./use-file-drop-zone";

type AttachmentOptions = Pick<
  ChatPanelProps,
  | "onSend"
  | "attachments"
  | "onAttachmentsChange"
  | "prepareAttachments"
  | "onAttachmentRejections"
  | "onNotice"
  | "composerLabels"
>;

/**
 * ChatPanel's attachments. They live at panel level so the ENTIRE panel is a
 * drop target, not just the composer. Controlled props are forwarded;
 * otherwise the files are managed here and cleared after a send.
 */
export function useChatPanelAttachments({
  onSend,
  attachments,
  onAttachmentsChange,
  prepareAttachments,
  onAttachmentRejections,
  onNotice,
  composerLabels,
}: AttachmentOptions) {
  const [files, setFiles] = useControllable<File[]>(
    attachments,
    onAttachmentsChange,
    [],
  );
  const isFilesControlled = attachments !== undefined;
  const addDroppedFiles = useAttachmentIntake({
    files,
    setFiles,
    prepareAttachments,
    onAttachmentRejections,
    onNotice,
    duplicateNotice: composerLabels?.fileAlreadyInChat,
    tooManyNotice: composerLabels?.tooManyFiles,
  });
  const tooManyFilesNotice = composerLabels?.tooManyFiles;
  const folderReadFailedNotice = composerLabels?.folderReadFailed;
  const onDropError = useCallback(
    (error: unknown) => {
      // No notice channel → rethrow: the failure surfaces as an unhandled
      // rejection (Sentry) instead of being silently swallowed.
      if (!onNotice) throw error;
      onNotice(
        error instanceof TooManyAttachmentFilesError
          ? (tooManyFilesNotice ?? DEFAULT_TOO_MANY_FILES_NOTICE)
          : (folderReadFailedNotice ??
              "Couldn't read the dropped folder. Try the attach button instead."),
      );
    },
    [onNotice, tooManyFilesNotice, folderReadFailedNotice],
  );
  const { isDraggingOver, dropProps } = useFileDropZone(
    addDroppedFiles,
    onDropError,
  );

  // In controlled mode the parent is responsible for clearing.
  const handleSend = useCallback(
    async (text: string, sent: File[], mentions: MessageMention[]) => {
      await onSend(text, sent, mentions);
      if (!isFilesControlled) setFiles([]);
    },
    [onSend, isFilesControlled, setFiles],
  );

  return { files, setFiles, handleSend, isDraggingOver, dropProps };
}
