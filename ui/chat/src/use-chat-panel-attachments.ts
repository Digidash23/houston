import { useCallback, useEffect, useRef } from "react";
import type { ChatPanelProps } from "./chat-panel-types";
import type { MessageMention } from "./types";
import { ingestAttachments } from "./use-attachment-intake";
import { useDropErrorNotice } from "./use-drop-error-notice";
import { useFileDropZone } from "./use-file-drop-zone";
import { useSessionFiles } from "./use-session-files";

type AttachmentOptions = Pick<
  ChatPanelProps,
  | "sessionKey"
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
 * otherwise the files are kept per conversation (`useSessionFiles`) and the
 * sent ones removed after a send.
 */
export function useChatPanelAttachments({
  sessionKey,
  onSend,
  attachments,
  onAttachmentsChange,
  prepareAttachments,
  onAttachmentRejections,
  onNotice,
  composerLabels,
}: AttachmentOptions) {
  const { files, setFiles, releaseFiles, ingestInto } = useSessionFiles(
    sessionKey,
    attachments,
    onAttachmentsChange,
  );
  const intake = {
    prepareAttachments,
    onAttachmentRejections,
    onNotice,
    duplicateNotice: composerLabels?.fileAlreadyInChat,
    tooManyNotice: composerLabels?.tooManyFiles,
  };
  const latestIntake = useRef(intake);
  useEffect(() => {
    latestIntake.current = intake;
  });
  // Bound to this render's conversation, read when it runs: a drop resolves
  // after its read, possibly once the drop target that caught it is gone.
  const addDroppedFiles = useCallback(
    (incoming: File[]) =>
      ingestInto(sessionKey, (current, write) =>
        ingestAttachments(
          { ...latestIntake.current, files: current, setFiles: write },
          incoming,
        ),
      ),
    [ingestInto, sessionKey],
  );
  const onDropError = useDropErrorNotice(onNotice, composerLabels);
  const { isDraggingOver, dropProps } = useFileDropZone(
    addDroppedFiles,
    onDropError,
  );

  const handleSend = useCallback(
    async (text: string, sent: File[], mentions: MessageMention[]) => {
      await onSend(text, sent, mentions);
      releaseFiles(sent);
    },
    [onSend, releaseFiles],
  );

  return {
    files,
    setFiles,
    releaseFiles,
    addDroppedFiles,
    handleSend,
    isDraggingOver,
    dropProps,
  };
}
