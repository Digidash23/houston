import { useMemo } from "react";
import type { Agent } from "../../lib/types";
import { useAgentBoardSend } from "../board/use-agent-board-send";
import { useBoardSendQueue } from "../board/use-board-send-queue";
import type { useAgentChatPanel } from "../use-agent-chat-panel";
import { useManagerHandoff } from "./use-manager-handoff";

type ComposerPin = Pick<
  ReturnType<typeof useAgentChatPanel>,
  "effectiveProvider" | "effectiveModel" | "turnMode" | "resolveSendPin"
>;

/**
 * The assistant chat's sends: the board send and its queue, on the pin the
 * composer shows, plus the first message onboarding may have left for it
 * ({@link useManagerHandoff}).
 *
 * No board behind this chat (`rawItems: undefined`, not an empty board): the
 * send hook's per-conversation loading then follows the SDK conversation VM
 * alone, which is the only lifecycle signal an activity-less chat has — it
 * starts the spinner on the turn and ends it on the settle.
 */
export function useAssistantSend(
  agent: Agent,
  sessionKey: string,
  pin: ComposerPin,
) {
  const overrides = useMemo(
    () => ({
      providerOverride: pin.effectiveProvider,
      modelOverride: pin.effectiveModel,
      modeOverride: pin.turnMode,
    }),
    [pin.effectiveProvider, pin.effectiveModel, pin.turnMode],
  );
  const send = useAgentBoardSend({
    agent,
    rawItems: undefined,
    openSessionKey: sessionKey,
  });
  const sendQueue = useBoardSendQueue({
    selectedSessionKey: sessionKey,
    selectedAgentPath: agent.folderPath,
    overrides,
    resolveSendPin: pin.resolveSendPin,
    sendMessageNow: send.sendMessageNow,
  });
  useManagerHandoff(sessionKey, sendQueue.sendAuthored);
  return { send, sendQueue };
}
