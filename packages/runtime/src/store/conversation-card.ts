import { join } from "node:path";
import { config } from "../config";
import { loadConversation } from "./conversation-file";
import { refusesInteractionAnswer } from "./interaction-owner";

const dir = join(config.dataDir, "conversations");

/**
 * {@link refusesInteractionAnswer} over this runtime's stored conversation, as
 * it stands now. Reads the live tail only: the card is always its last turn.
 */
export function storedCardRefuses(
  id: string,
  actingUserId: string | undefined,
): boolean {
  if (!actingUserId) return false;
  return refusesInteractionAnswer(
    loadConversation(dir, id)?.messages ?? [],
    actingUserId,
  );
}
