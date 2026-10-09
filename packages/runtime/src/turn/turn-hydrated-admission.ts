import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { loadConversation } from "../store/conversation-file";
import {
  notInteractionOwnerBody,
  refusesInteractionAnswer,
} from "../store/interaction-owner";
import { json } from "./server-http";
import type { TurnFilesystemPreparation } from "./turn-filesystem";
import { TurnSetupError } from "./turn-layout";
import {
  reportAbandonedTurnStartup,
  type TurnSessionStartupTask,
} from "./turn-session-startup";
import type { TurnRequest } from "./types";

/**
 * The last refusals a pooled turn can meet, once its tree is hydrated and
 * before the stream opens. Resolves true when the turn was refused and already
 * answered; an overlapped session startup is abandoned on every refusal.
 *
 * A message from someone the conversation's live card is not for is a plain
 * 403 JSON answer, never a setup-error frame: the gateway maps the worker's
 * 403 to its own, and neither the turnlog nor the transcript may record a turn
 * that never ran. Routine runs are exempt: they share one conversation and act
 * as different people (the creator on schedule, whoever clicked "run now").
 */
export async function refuseHydratedTurn(input: {
  turn: TurnRequest;
  preparation: TurnFilesystemPreparation;
  sandbox: { admission: () => Promise<string | null> } | null;
  startup: TurnSessionStartupTask | undefined;
  timings: Record<string, number>;
  res: ServerResponse;
}): Promise<boolean> {
  try {
    const { dataDir } = await input.preparation.hydrated;
    input.timings.t_hydrated = performance.now();
    if (!input.turn.routine && !input.turn.shadow) {
      const messages =
        loadConversation(
          join(dataDir, "conversations"),
          input.turn.conversationId,
        )?.messages ?? [];
      if (refusesInteractionAnswer(messages, input.turn.actingAs?.userId)) {
        await reportAbandonedTurnStartup(input.startup);
        json(input.res, 403, notInteractionOwnerBody);
        return true;
      }
    }
    const refused = await input.sandbox?.admission();
    if (refused) throw new TurnSetupError("message_refused", refused);
    return false;
  } catch (error) {
    await reportAbandonedTurnStartup(input.startup);
    throw error;
  }
}
