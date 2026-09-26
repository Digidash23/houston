import { ChatPanel, type FeedItem } from "@houston-ai/chat";
import { type ReactNode, useEffect, useRef } from "react";
import { useVisualViewportInset } from "../../../hooks/use-visual-viewport-inset";
import type { ScriptLine } from "../../../lib/manager-onboarding/script";
import { AssistantPhoneHeader } from "../assistant-phone-header";
import { ManagerReceipt } from "./manager-receipt";
import type { ScriptCopy } from "./use-script-copy";
import { useScriptedReveal } from "./use-scripted-reveal";

const SESSION_KEY = "manager-onboarding";
const noSend = async () => {};

/**
 * The scripted onboarding conversation, rendered by the SAME chat the real
 * AI Manager uses (`ChatPanel`): the manager's lines are its messages, typed
 * out like a streamed reply, and each answer is the person's reply, the
 * receipt a real answered question leaves. The step in hand sits in the
 * composer's slot and REPLACES it, the way an in-chat question does, so the
 * person answers on the step: there is no message to write.
 *
 * `prompt` stays mounted while the manager types (only hidden), so a step
 * holding live work, the team being hired, never loses it between messages.
 *
 * The step takes its height from the log, never covers it: the log holds its
 * latest line in view as the step comes, grows and goes, and the chat area is
 * a size container, so a step caps itself against the room the chat has left
 * (the phone keyboard's share taken out) rather than against the screen.
 *
 * An answer is the person's send: each one landing (and each taken back to
 * change) brings the latest line into view, even for a person who scrolled up
 * to read the history.
 */
export function ManagerChat({
  lines,
  copy,
  prompt,
  locked = false,
  onChange,
  onSaid,
}: {
  lines: ScriptLine[];
  copy: ScriptCopy;
  prompt: ReactNode;
  /** Work is landing that no answer may undo: nothing offers a change. */
  locked?: boolean;
  /** Asks the question of the latest answer again. */
  onChange: (line: Extract<ScriptLine, { kind: "receipt" }>) => void;
  /** Everything is said, for a conversation that ends with nothing to
   *  answer. May be called more than once. */
  onSaid?: () => void;
}) {
  const reveal = useScriptedReveal(lines, copy.manager);
  const saidRef = useRef(onSaid);
  saidRef.current = onSaid;
  const awaitingSaid = onSaid !== undefined;
  useEffect(() => {
    if (reveal.settled && awaitingSaid) saidRef.current?.();
  }, [reveal.settled, awaitingSaid]);
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useVisualViewportInset(rootRef);
  const byKey = new Map(lines.map((line) => [`user-${line.key}`, line]));
  const answers = lines.filter((line) => line.kind === "receipt").length;

  const feed: FeedItem[] = reveal.shown.map((line) =>
    line.kind === "manager"
      ? { feed_type: "assistant_text", id: line.key, data: copy.manager(line) }
      : {
          feed_type: "user_message",
          id: line.key,
          data: copy.receipt(line).answer,
        },
  );
  if (reveal.typing)
    feed.push({
      feed_type: "assistant_text_streaming",
      id: reveal.typing.key,
      data: reveal.typing.text,
    });

  return (
    <div
      ref={rootRef}
      data-testid="manager-onboarding"
      className="flex h-full min-h-0 flex-col pb-safe"
      // iOS does not shrink `dvh` when the keyboard opens: without this the
      // step's field would sit under the keys, as in the real chat.
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      <AssistantPhoneHeader />
      <div className="@container-size flex min-h-0 flex-1 flex-col">
        <ChatPanel
          sessionKey={SESSION_KEY}
          feedItems={feed}
          isLoading={false}
          // Stated, not derived: an answer that ends the feed would otherwise
          // read as a reply on its way, with the thinking line under it.
          status={reveal.typing ? "streaming" : "ready"}
          onSend={noSend}
          scrollToLatestToken={answers}
          renderUserMessage={(message) => {
            const line = byKey.get(message.key);
            if (line?.kind !== "receipt") return undefined;
            return (
              <ManagerReceipt
                copy={copy.receipt(line)}
                onChange={
                  line.editable && reveal.settled && !locked
                    ? () => onChange(line)
                    : undefined
                }
              />
            );
          }}
          composerOverrideMode="replace"
          composerOverride={
            <div
              data-testid="manager-onboarding-prompt"
              hidden={!reveal.settled}
            >
              {prompt}
            </div>
          }
        />
      </div>
    </div>
  );
}
