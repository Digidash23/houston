/**
 * Lines said somewhere else, written into a chat as its real history: the AI
 * Manager's scripted onboarding lands in the manager's own conversation this
 * way, so the chat that follows shows it and the model reads it. Each import
 * rides the outbox (`conversation-import-outbox.ts`), so one that fails is
 * sent again by `retryPendingImports`.
 */

import type {
  ConversationImportRequest,
  ConversationImportResult,
} from "@houston/protocol";
import type { ModuleContext } from "../../module-context";
import { createConversationImportOutbox } from "./conversation-import-outbox";
import { asAgentInput, asImportInput } from "./turn-inputs";

/** Which import, into which chat. */
export interface ConversationImportRef {
  agentId: string;
  conversationId: string;
  importId: string;
}

/** What one retry pass came to: the imports that landed and why others did not. */
export interface ConversationImportRetry {
  landed: (ConversationImportRef & { imported: number })[];
  failures: (ConversationImportRef & { error: unknown })[];
}

export function createConversationImports(ctx: ModuleContext) {
  const outbox = createConversationImportOutbox(ctx);

  /**
   * Writes lines said somewhere else into a chat as its real history.
   *
   * No turn runs. The lines land after everything already in the chat, in
   * order, and the next turn carries them to the model as earlier context.
   * The import is written down on this device before it is sent, so one that
   * fails is sent again by retryPendingImports; `importId` names it, and an
   * import that already landed writes nothing (`imported: 0`). Answers 409
   * while a turn holds the chat.
   * @param conversationId The chat the lines go into.
   * @param agentId The agent this acts on, by the id listAgents returns. An
   *   agent's name is not its id, so read the id from listAgents first.
   * @param request `importId` (lowercase letters, digits, `:`, `_`, `-`) and
   *   the `messages`, each `{ role: "user" | "assistant", content }`.
   * @assistant group:chat
   * @assistant hidden: it writes lines into a chat as though they had been said there; only the surface that held that conversation knows what was said, so anything else writing them would forge the person's history.
   */
  const importMessages = async (
    conversationId: string,
    agentId: string,
    request: ConversationImportRequest,
  ): Promise<ConversationImportResult> => {
    const entry = { agentId, conversationId, request };
    await outbox.owe(entry);
    let result: ConversationImportResult;
    try {
      result = await ctx
        .clientFor(agentId)
        .importMessages(conversationId, request);
    } catch (err) {
      await outbox.settle(entry, err);
      throw err;
    }
    await outbox.settle(entry);
    return result;
  };

  /**
   * Sends again every import this device still owes one agent.
   *
   * Only that agent's are sent: a device another person signs in to holds
   * theirs too, which are not this person's to send (their agent refuses
   * them, and the refusal would cross them off). Each one that lands is
   * crossed off and listed in `landed`; one the runtime can never accept
   * (not an import, an agent that is gone) is crossed off and its refusal
   * listed in `failures`, as is every one still owed for the next try.
   * @param agentId The agent whose owed imports to send, by the id listAgents
   *   returns.
   */
  const retryPendingImports = async (
    agentId: string,
  ): Promise<ConversationImportRetry> => {
    const outcome: ConversationImportRetry = { landed: [], failures: [] };
    const owed = await outbox.owed();
    for (const entry of owed.filter((e) => e.agentId === agentId)) {
      const ref: ConversationImportRef = {
        agentId: entry.agentId,
        conversationId: entry.conversationId,
        importId: entry.request.importId,
      };
      try {
        const { imported } = await importMessages(
          entry.conversationId,
          entry.agentId,
          entry.request,
        );
        outcome.landed.push({ ...ref, imported });
      } catch (error) {
        outcome.failures.push({ ...ref, error });
      }
    }
    return outcome;
  };

  ctx.registerCommand("turns/importMessages", (payload) => {
    const input = asImportInput(payload);
    return importMessages(input.conversationId, input.agentId, input.request);
  });
  ctx.registerCommand("turns/retryPendingImports", (payload) =>
    retryPendingImports(asAgentInput(payload, "turns/retryPendingImports")),
  );

  return { importMessages, retryPendingImports };
}
