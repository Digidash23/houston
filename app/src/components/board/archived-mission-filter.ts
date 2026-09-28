import type { RawConversation } from "../../lib/conversations-facade";
import { isSetupChatMode } from "../../lib/integration-chat-setup";
import { ARCHIVED_STATUS } from "../../lib/mission-selection";

export function archivedMissionRows(
  conversations: readonly RawConversation[],
): RawConversation[] {
  // Guided setup chats never become user-managed missions.
  return conversations.filter(
    (conversation) =>
      conversation.type === "activity" &&
      conversation.status === ARCHIVED_STATUS &&
      !isSetupChatMode(conversation.agent),
  );
}
