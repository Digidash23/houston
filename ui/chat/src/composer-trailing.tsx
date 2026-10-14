/**
 * The composer's trailing controls: the dictate mic and the send/stop button,
 * or the dictation actions while a capture runs. Internal to ChatInput.
 */

import { MicIcon } from "lucide-react";
import { PromptInputSubmit } from "./ai-elements/prompt-input";
import { DictationActions, DictationTranscribing } from "./dictation-controls";
import type { DictationControl } from "./dictation-types";
import { isDictationActive, resolveDictationView } from "./dictation-types";

export interface ComposerTrailingProps {
  status: "ready" | "streaming" | "submitted";
  hasContent: boolean;
  onStop?: () => void;
  /** When absent (e.g. the web build) no mic affordance renders at all. */
  dictation?: DictationControl;
  /** Locks the composer: submit goes inert and the mic is hidden. */
  disabled?: boolean;
  /** The send button's names; English defaults. */
  submitLabels?: { submit?: string; stop?: string };
}

/**
 * Trailing button row. Idle/absent: an optional mic button (idle) + the
 * always-visible submit. While a capture is in flight the composer's input row
 * is taken over by the waveform, so this slot swaps to the dictation actions
 * (✕ cancel + ✓ accept, or a transcribing spinner) and hides submit entirely.
 */
export function ComposerTrailing({
  status,
  hasContent,
  onStop,
  dictation,
  disabled = false,
  submitLabels,
}: ComposerTrailingProps) {
  const view = resolveDictationView(dictation);

  if (isDictationActive(dictation) && dictation) {
    return (
      <div className="flex items-center gap-1.5 [grid-area:trailing]">
        {view.kind === "transcribing" ? (
          <DictationTranscribing label={dictation.labels.transcribing} />
        ) : (
          <DictationActions control={dictation} />
        )}
      </div>
    );
  }

  const submitDisabled = disabled || (status === "ready" && !hasContent);
  return (
    // Phone gap 8px: the mic's and send's 4px hit-slops meet without overlap.
    <div className="flex items-center gap-2 [grid-area:trailing] md:gap-1.5">
      {view.kind === "idle" && status === "ready" && !disabled && dictation && (
        <button
          type="button"
          onClick={dictation.onStart}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-hover transition-colors after:absolute after:-inset-1 md:after:hidden"
          aria-label={dictation.labels.start}
        >
          <MicIcon className="size-5" />
        </button>
      )}
      <PromptInputSubmit
        status={status}
        onStop={onStop}
        disabled={submitDisabled}
        labels={submitLabels}
      />
    </div>
  );
}
