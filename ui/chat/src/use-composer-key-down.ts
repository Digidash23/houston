import { type KeyboardEvent, useCallback } from "react";
import type { InputStatus } from "./chat-input-types";
import type { DictationControl } from "./dictation-types";
import { isDictationCapturing } from "./dictation-types";

/**
 * The composer textarea's key handling beyond typing and Enter: the @mention
 * list first, then Escape, which discards an in-flight dictation capture
 * before it stops a running turn.
 */
export function useComposerKeyDown(opts: {
  mentionKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  dictation?: DictationControl;
  status: InputStatus;
  onStop?: () => void;
}) {
  const { mentionKeyDown, dictation, status, onStop } = opts;
  return useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // The mention list gets first say: every key it consumes is
      // `preventDefault()`ed, which is what makes PromptInputTextarea bail
      // before its own Enter handling and keeps Escape off the stop handler.
      mentionKeyDown(e);
      if (e.defaultPrevented) return;
      if (e.key === "Escape" && isDictationCapturing(dictation)) {
        e.preventDefault();
        dictation?.onCancel();
        return;
      }
      if (e.key === "Escape" && status !== "ready" && onStop) {
        e.preventDefault();
        onStop();
      }
    },
    [status, onStop, dictation, mentionKeyDown],
  );
}
