/**
 * Conversation imports as the app reaches them: lines said elsewhere (the AI
 * Manager's scripted onboarding) written into a conversation as its real
 * history, wrapped in the same error-surfacing policy every other engine call
 * gets.
 *
 * Part of `./tauri` rather than a layer of its own. It sits in its own file only
 * because that module is the app's whole engine-facing surface and has no business
 * growing a namespace per feature; it reaches the engine through `getEngine()`
 * and its failures through `engineCall` and `surfaceEngineError`, exactly as the
 * namespaces still living there do (`scripts/check-boundaries.mjs` rule D names
 * this file for that reason).
 *
 * The SDK owns the import: it owes one until it lands, on this device, and
 * re-seeds the chat so it opens showing the imported lines.
 */

import type {
  ConversationImportRequest,
  ConversationImportResult,
} from "@houston/wire-types";
import { getEngine } from "./engine";
import { engineCall, surfaceEngineError } from "./tauri";

export const tauriConversationImports = {
  /** Import `request` into the conversation. A failure is surfaced here and
   *  stays owed, so {@link tauriConversationImports.retryOwed} sends it again. */
  send: (
    agentPath: string,
    conversationId: string,
    request: ConversationImportRequest,
  ) =>
    engineCall<ConversationImportResult>("import_conversation", () =>
      getEngine().importConversationMessages(
        agentPath,
        conversationId,
        request,
      ),
    ),
  /** Send again every import this device still owes the agent at
   *  `agentPath`. Each failure is surfaced like a failed import, and stays
   *  owed for the next try. */
  retryOwed: (agentPath: string) =>
    engineCall<void>("retry_conversation_imports", async () => {
      const failures =
        await getEngine().retryPendingConversationImports(agentPath);
      for (const err of failures)
        await surfaceEngineError("import_conversation", err);
    }),
};
