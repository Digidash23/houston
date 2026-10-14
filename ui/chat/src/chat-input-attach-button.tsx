/**
 * The composer's "+" button: opens the file picker, or a small menu (files,
 * folder, and whatever the caller adds) when the caller supplies one.
 */

import { Popover, PopoverContent, PopoverTrigger } from "@houston-ai/core";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

type AttachMenuApi = {
  openFilePicker: () => void;
  openFolderPicker: () => void;
  close: () => void;
};

interface ChatInputAttachButtonProps {
  onOpenFilePicker: () => void;
  onOpenFolderPicker: () => void;
  /** Optional popover menu. When provided, clicking the paperclip opens a
   *  popover instead of invoking `onOpenFilePicker` directly. The render-prop
   *  form receives an API the caller uses to trigger the file or folder
   *  picker from inside the menu and close the popover. */
  attachMenu?: ReactNode | ((api: AttachMenuApi) => ReactNode);
  ariaLabel?: string;
  /** Locks the button inert (keyboard focus survives the composer's
   *  pointer-events lock, so the button must opt out on its own). */
  disabled?: boolean;
}

export function ChatInputAttachButton({
  onOpenFilePicker,
  onOpenFolderPicker,
  attachMenu,
  ariaLabel = "Attach files",
  disabled = false,
}: ChatInputAttachButtonProps) {
  const [open, setOpen] = useState(false);

  const button = (
    <button
      type="button"
      onClick={attachMenu ? undefined : onOpenFilePicker}
      disabled={disabled}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-hover transition-[color,background-color,scale] active:scale-[0.96] md:active:scale-100 after:absolute after:-inset-1 disabled:pointer-events-none md:after:hidden"
      aria-label={ariaLabel}
    >
      <Plus className="size-5" />
    </button>
  );

  if (!attachMenu) {
    return (
      <div className="flex items-center [grid-area:leading]">{button}</div>
    );
  }

  const content =
    typeof attachMenu === "function"
      ? attachMenu({
          openFilePicker: () => {
            setOpen(false);
            onOpenFilePicker();
          },
          openFolderPicker: () => {
            setOpen(false);
            onOpenFolderPicker();
          },
          close: () => setOpen(false),
        })
      : attachMenu;

  return (
    <div className="flex items-center [grid-area:leading]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-auto min-w-56 p-1.5"
        >
          {content}
        </PopoverContent>
      </Popover>
    </div>
  );
}
