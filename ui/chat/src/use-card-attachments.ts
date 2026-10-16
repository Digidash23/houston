"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatComposerLabels } from "./chat-panel-types";
import type { ChatInteractionAnswer } from "./interaction-card-logic";
import type { CardCompletion } from "./interaction-card-props";
import { usePanelAttachments } from "./panel-attachments-context";
import {
  isCompletionPending,
  markCompletionPending,
  settleCompletion,
  useCompletionPending,
} from "./pending-completions";
import {
  type ComposerAttachments,
  useComposerAttachments,
} from "./use-composer-attachments";
import { useDropErrorNotice } from "./use-drop-error-notice";

/** What a question's answer row needs to offer the composer's attach surface. */
export interface CardAttach extends ComposerAttachments {
  labels?: ChatComposerLabels;
  /** Reports a failed folder drop on a drop target inside the card. */
  onDropError: (error: unknown) => void;
}

/**
 * The card's view of the enclosing ChatPanel's attachment list (see
 * `PanelAttachmentsContext`). `attach` is `null` outside a composer-replacing
 * ChatPanel slot: a card with no panel list behind it offers no "+", so no
 * consumer ever collects files it has nowhere to send.
 *
 * `complete` hands the files to `onComplete` with the answers, and releases
 * them (see `PanelAttachments.releaseFiles`) only once the consumer reports
 * it accepted them: a send that fails keeps them for the retry. Files ride
 * only a completion that answered a question; a declined card or a
 * connect/sign-in-only one leaves them for the composer that returns.
 *
 * One completion per `completionKey` is in flight at a time (`pending`), so
 * a second click during the upload cannot send the answer apart from its
 * files, and neither can a remount of the same card. Without a key the
 * latch lasts only as long as this instance.
 */
export function useCardAttachments(
  onComplete: CardCompletion,
  completionKey?: string,
): {
  attach: CardAttach | null;
  complete: (answers: ChatInteractionAnswer[]) => void;
  pending: boolean;
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
  const onDropError = useDropErrorNotice(
    panel?.onNotice,
    panel?.composerLabels,
  );
  // Read at completion, not at render: a connect step's OAuth hand-off can
  // complete the card long after the render that created its callback. Once
  // the card is unmounted the list belongs to whatever replaced it, so a late
  // completion hands over nothing.
  const latest = useRef(panel);
  useEffect(() => {
    latest.current = panel;
  });
  // Starts true: a restored terminal step completes from a descendant's mount
  // effect, which runs before any effect of this hook.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [ownKey] = useState(() => Symbol("card-completion"));
  const key = completionKey ?? ownKey;
  const pending = useCompletionPending(key);

  const complete = useCallback(
    (answers: ChatInteractionAnswer[]) => {
      if (isCompletionPending(key)) return;
      const current = alive.current ? latest.current : null;
      const files = answers.length > 0 ? [...(current?.files ?? [])] : [];
      const result = onComplete(answers, files);
      if (!(result instanceof Promise)) {
        current?.releaseFiles(files);
        return;
      }
      markCompletionPending(key);
      // Freed before releasing: a throwing release must not leave every card
      // with this key disabled until reload.
      const settle = (accepted: boolean) => {
        settleCompletion(key);
        if (accepted) current?.releaseFiles(files);
      };
      // The contract is never to reject; one that does still frees the card
      // and stays an unhandled rejection, so it is reported, not swallowed.
      void result.then(settle, (err: unknown) => {
        settle(false);
        throw err;
      });
    },
    [key, onComplete],
  );
  return {
    attach: panel
      ? { ...composer, labels: panel.composerLabels, onDropError }
      : null,
    complete,
    pending,
  };
}
