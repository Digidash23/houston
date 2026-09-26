import { useEffect, useRef } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { useConversationScrollAnimation } from "./conversation-viewport-pin";

export type ConversationAutoScrollProps = {
  status: "ready" | "streaming" | "submitted";
  /** Changes when the person acts in a way that must show them the newest
   *  line, wherever they had scrolled to. */
  latestToken?: number;
};

/**
 * Brings the latest message into view, even for a person scrolled up to read:
 * when a submission starts, and when `latestToken` changes. Both are the
 * person's own deliberate act, so both re-pin the log; anything else arriving
 * leaves a scrolled-up reader where they are. Mount inside a <Conversation>.
 */
export const ConversationAutoScroll = ({
  status,
  latestToken,
}: ConversationAutoScrollProps) => {
  const { scrollToBottom } = useStickToBottomContext();
  const animation = useConversationScrollAnimation();
  const prevStatusRef = useRef(status);
  const prevTokenRef = useRef(latestToken);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status === "submitted" && prev !== "submitted")
      scrollToBottom({ animation });
  }, [status, scrollToBottom, animation]);

  useEffect(() => {
    if (prevTokenRef.current === latestToken) return;
    prevTokenRef.current = latestToken;
    scrollToBottom({ animation });
  }, [latestToken, scrollToBottom, animation]);

  return null;
};
