import {
  CONVERSATION_IMPORT_INVALID,
  type ConversationImportResult,
  parseConversationImportRequest,
} from "@houston/protocol";
import { importConversation } from "../session/import-conversation";
import { json, type RouteContext, readJson } from "./http-helpers";
import { refuseNonCardOwner } from "./interaction-owner-gate";

/**
 * `POST /conversations/:id/import`: 200 `{ ok, imported }` (0 when the import
 * had already landed), 400 for a body that is not an import, 403 while a live
 * card is someone else's, 409 while a turn holds the conversation.
 */
export async function handleConversationImport(
  ctx: RouteContext,
  id: string,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJson(ctx.req);
  } catch {
    // Unparseable JSON is the same refusal as a malformed import.
    body = null;
  }
  const request = parseConversationImportRequest(body);
  if (!request) {
    json(ctx.res, 400, {
      error: "not a conversation import",
      code: CONVERSATION_IMPORT_INVALID,
    });
    return;
  }
  if (refuseNonCardOwner(ctx, id)) return;
  const outcome = await importConversation(id, request);
  if (outcome === "busy") {
    json(ctx.res, 409, { error: "turn running" });
    return;
  }
  const result: ConversationImportResult = {
    ok: true,
    imported: outcome.imported,
  };
  json(ctx.res, 200, result);
}
