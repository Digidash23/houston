"use client";

import { cn } from "@houston-ai/core";
import { ArrowUp } from "lucide-react";
import { useRef } from "react";
import { ChatInputAttachButton } from "./chat-input-attach-button";
import type { CardAttach } from "./use-card-attachments";

/** The free-text escape row: the answer field the user types their OWN answer
 *  into. It is a MINIATURE of the real composer so nothing about it needs
 *  learning: the same 28px pill roundness, the same `border-line-input` hairline,
 *  the composer's leading "+" when the card carries the panel's attachments,
 *  and the same circular arrow-up send button that turns on (bg-action at
 *  full strength) the moment there is text or a file — dimmed while empty,
 *  exactly like the chat input's send. Clicking anywhere in the field focuses
 *  the textarea; typing expands it; Enter or the arrow submits; pasting a file
 *  attaches it. The card-wide decline is NOT here — it lives in the modal
 *  footer, so this row is purely the input it looks like. On a free-text-only
 *  question (no options) it is the primary answer field, so it takes a neutral
 *  placeholder. */
export function FreeTextRow({
  value,
  placeholder,
  sendLabel,
  disabled,
  attach,
  onChange,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  sendLabel: string;
  disabled: boolean;
  attach?: CardAttach | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 || (attach?.files.length ?? 0) > 0;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus-delegation surface — the real widget is the <textarea> inside; clicking the field's padding focuses it (mirrors the composer). role="presentation" is correct, no widget role applies.
    <div
      className={cn(
        "mt-1.5 flex cursor-text items-center gap-2 rounded-[28px] border border-line-input bg-transparent pr-1.5 transition-colors dark:bg-line-input/30",
        // The "+" is 4px taller than the send button, so the row trims its
        // vertical padding to keep the pill at the same height.
        attach ? "gap-1 py-1 pl-1" : "py-1.5 pl-4",
        "focus-within:border-focus",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={() => textareaRef.current?.focus()}
      role="presentation"
    >
      {attach && (
        <ChatInputAttachButton
          ariaLabel={attach.labels?.attachFiles}
          disabled={disabled}
          onOpenFilePicker={attach.openFilePicker}
          onOpenFolderPicker={attach.openFolderPicker}
        />
      )}
      <textarea
        className="max-h-40 min-w-0 flex-1 resize-none border-none bg-transparent py-1 text-ink text-sm leading-snug outline-none placeholder:text-ink-muted"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onPaste={attach?.handlePaste}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />
      {/* The composer's send button, verbatim: circular arrow-up that turns on
          with text (disabled:opacity-30 while empty, like the chat input). */}
      <button
        aria-label={sendLabel}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-action-text transition-colors hover:bg-action/90 disabled:opacity-30"
        disabled={disabled || !canSend}
        onClick={(e) => {
          e.stopPropagation();
          onSubmit();
        }}
        type="button"
      >
        <ArrowUp className="size-4" />
      </button>
    </div>
  );
}
