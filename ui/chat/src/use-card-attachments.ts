"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatComposerLabels } from "./chat-panel-types";
import type { ChatInteractionAnswer } from "./interaction-card-logic";
import type { CardCompletion } from "./interaction-card-props";
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
 * consumer ever collects files it has nowhere to send.
 *
 * `complete` hands the files to `onComplete` with the answers, and removes
 * them from the list only once the consumer reports it accepted them: a send
 * that fails keeps them for the retry. Files ride only a completion that
 * answered a question; a declined card or a connect/sign-in-only one leaves
 * them for the composer that returns. One completion is in flight at a time
 * (`pending`), so a second click during the upload cannot send the answer
 * apart from its files.
 */
export function useCardAttachments(onComplete: CardCompletion): {
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
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  const complete = useCallback(
    (answers: ChatInteractionAnswer[]) => {
      if (inFlight.current) return;
      const current = alive.current ? latest.current : null;
      const files = answers.length > 0 ? [...(current?.files ?? [])] : [];
      const result = onComplete(answers, files);
      if (!(result instanceof Promise)) {
        current?.releaseFiles(files);
        return;
      }
      inFlight.current = true;
      setPending(true);
      const settle = (accepted: boolean) => {
        if (accepted) current?.releaseFiles(files);
        inFlight.current = false;
        if (alive.current) setPending(false);
      };
      // The contract is never to reject; one that does still frees the card
      // and stays an unhandled rejection, so it is reported, not swallowed.
      void result.then(settle, (err: unknown) => {
        settle(false);
        throw err;
      });
    },
    [onComplete],
  );
  return {
    attach: panel ? { ...composer, labels: panel.composerLabels } : null,
    complete,
    pending,
  };
}
