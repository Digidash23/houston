import { historyToFeed as sdkHistoryToFeed } from "@houston/sdk";
import type {
  ConversationImportRequest,
  ConversationImportResult,
} from "@houston/wire-types";
import { CHAT_OPEN_WINDOW } from "../history-window";
import { DEFAULT_AGENT_PATH } from "../synthetic";
import { seedConversationVm } from "../turn-stream";
import { runtimeScope } from "./chat-scope";
import type { AdapterContext } from "./context";
import { toHoustonEngineError, viaSdk } from "./sdk-error";

/**
 * Lines said elsewhere, landed as a conversation's real history
 * (`sdk.turns.importMessages`), and the local fold that follows: the chat's
 * conversation VM is re-seeded from the host's own transcript, so a chat
 * opening right after the import shows the lines at once instead of an empty
 * beat while its history loads.
 */

const importPath = (agentPath: string, conversationId: string): string =>
  `/agents/${encodeURIComponent(agentPath)}/conversations/${encodeURIComponent(conversationId)}/import`;

async function reseed(
  ctx: AdapterContext,
  agentPath: string,
  conversationId: string,
): Promise<void> {
  const history = await ctx.sdk
    .clientFor(runtimeScope(ctx, agentPath))
    .getHistory(conversationId, { limit: CHAT_OPEN_WINDOW });
  seedConversationVm(
    agentPath,
    conversationId,
    sdkHistoryToFeed(history.messages),
    {
      earliestLoaded: history.offset ?? 0,
      total: history.totalMessages ?? history.messages.length,
    },
  );
}

export async function importConversation(
  ctx: AdapterContext,
  agentPath: string,
  conversationId: string,
  request: ConversationImportRequest,
): Promise<ConversationImportResult> {
  const path = agentPath || DEFAULT_AGENT_PATH;
  const result = await viaSdk(importPath(path, conversationId), () =>
    ctx.sdk.turns.importMessages(
      conversationId,
      runtimeScope(ctx, path),
      request,
    ),
  );
  if (result.imported > 0) await reseed(ctx, path, conversationId);
  return result;
}

/**
 * Send again every import this device still owes the agent at `agentPath`,
 * re-seeding each chat one landed in. Resolves with the failures, each as the
 * `HoustonEngineError` the app classifies: one still owed is sent again on
 * the next call.
 */
export async function retryPendingImports(
  ctx: AdapterContext,
  agentPath: string,
): Promise<unknown[]> {
  const { landed, failures } = await ctx.sdk.turns.retryPendingImports(
    runtimeScope(ctx, agentPath || DEFAULT_AGENT_PATH),
  );
  for (const entry of landed) {
    // An empty scope is the flat local runtime, whose chats this client keys
    // by a path the owed entry never held: its next open reads the history.
    if (entry.imported === 0 || entry.agentId === "") continue;
    await reseed(ctx, entry.agentId, entry.conversationId);
  }
  return failures.map((failure) =>
    toHoustonEngineError(
      failure.error,
      importPath(failure.agentId, failure.conversationId),
    ),
  );
}
