"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ChatComposerLabels } from "./chat-panel-types";
import type { ChatInteractionAnswer } from "./interaction-card-logic";
import { usePanelAttachments } from "./panel-attachments-context";
import {
  type ComposerAttachments,
  useComposerAttachments,
} from "./use-composer-attachments";

/** What a question's answer row needs to offer the composer's attach surface. */
export interface CardAttach extends ComposerAttachments {
  labels?: ChatComposerLabels;
}

/**
 * The card's view of the enclosing ChatPanel's attachment list (see
 * `PanelAttachmentsContext`). `attach` is `null` outside a composer-replacing
 * ChatPanel slot: a card with no panel list behind it offers no "+", so no
 * consumer ever collects files it has nowhere to send. `complete` hands the
 * list to `onComplete` with the answers and empties it, so the files leave
 * with the answer exactly once.
 */
export function useCardAttachments(
  onComplete: (answers: ChatInteractionAnswer[], files: File[]) => void,
): {
  attach: CardAttach | null;
  complete: (answers: ChatInteractionAnswer[]) => void;
} {
  const panel = usePanelAttachments();
  const composer = useComposerAttachments({
    attachments: panel?.files,
    onAttachmentsChange: panel?.setFiles,
    prepareAttachments: panel?.prepareAttachments,
    onAttachmentRejections: panel?.onAttachmentRejections,
    onNotice: panel?.onNotice,
    labels: panel?.composerLabels,
  });
  // Read at completion, not at render: a connect step's OAuth hand-off can
  // complete the card long after the render that created its callback. Once
  // the card is unmounted the list belongs to whatever replaced it, so a late
  // completion hands over nothing and leaves the list alone.
  const latest = useRef(panel);
  const mounted = useRef(false);
  useEffect(() => {
    latest.current = panel;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const complete = useCallback(
    (answers: ChatInteractionAnswer[]) => {
      const current = mounted.current ? latest.current : null;
      const files = current?.files ?? [];
      onComplete(answers, files);
      if (files.length > 0) current?.setFiles([]);
    },
    [onComplete],
  );
  return {
    attach: panel ? { ...composer, labels: panel.composerLabels } : null,
    complete,
  };
}
