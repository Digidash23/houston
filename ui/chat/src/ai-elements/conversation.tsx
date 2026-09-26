"use client";

import { Button, cn } from "@houston-ai/core";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useState } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { useConversationScrollAnimation } from "./conversation-viewport-pin";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => {
  const animation = useConversationScrollAnimation();
  return (
    <StickToBottom
      // The element rendered here is NOT the scroll container — it just
      // wraps one. use-stick-to-bottom builds a second div inside
      // <StickToBottom.Content> and sets overflow:auto on that div via
      // its scrollRef, so the inner pane is what actually scrolls. We
      // keep role="log" + tabIndex={-1} on the outer so the app shell
      // can focus it on Escape; the programmatic chat-scroll lives in
      // use-keyboard-shortcuts and targets the inner pane by class.
      className={cn("relative flex-1 outline-none", className)}
      initial={animation}
      resize={animation}
      role="log"
      tabIndex={-1}
      {...props}
    />
  );
};

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    // `scrollClassName` lands on the real scroll pane (the div the
    // library binds its scrollRef to). The `conversation-scroll-pane`
    // marker class is the stable selector the keyboard-shortcut layer
    // uses to step-scroll the log with arrow keys.
    scrollClassName="conversation-scroll-pane"
    // Top clearance matches the ConversationTopFade height (h-8): a
    // conversation that overflows by only a few pixels gets pinned to the
    // bottom by stick-to-bottom, and without this headroom the FIRST row
    // (usually the collapsed "Mission log" line) sat half-dissolved under
    // the fade at rest — reading as clipped by the panel header. Small
    // overflows now scroll padding out of view, never the first message.
    className={cn("flex flex-col gap-8 px-4 pb-4 pt-8", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-ink-muted">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-ink-muted text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

/**
 * Top scroll fade: a canvas-colored gradient pinned under the panel header,
 * visible ONLY while content is scrolled — a streaming line then dissolves as
 * it leaves the viewport instead of hard-clipping mid-glyph against the
 * header's border. In light it fades from `canvas`, the EXACT tone the chat
 * panel and its header wear, so header, fade, and body read as one color (the
 * old `background` white showed as a pale seam on the gray canvas); dark keeps
 * fading from `background` — the dark canvas token is translucent glass, which
 * cannot anchor an opaque fade. At rest (nothing scrolled out) it is fully
 * transparent, so the first message never renders washed out. Mount inside
 * a <Conversation>.
 */
export const ConversationTopFade = () => {
  const { scrollRef } = useStickToBottomContext();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Programmatic scrolls (the stick-to-bottom spring) fire scroll events
    // too, so one listener covers user and auto scrolling alike.
    const onScroll = () => setScrolled(el.scrollTop > 0);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-10 h-8",
        "bg-gradient-to-b from-background to-transparent dark:from-input",
        "transition-opacity duration-150",
        scrolled ? "opacity-100" : "opacity-0",
      )}
    />
  );
};

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-input dark:hover:bg-chip-subtle",
          className,
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
