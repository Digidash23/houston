import { z } from "zod";
import type { ChatMessage } from "./conversation";

/**
 * `POST /conversations/:id/import`: lines a conversation already held
 * somewhere else (the AI Manager's scripted onboarding) written into the
 * transcript as real history, with no turn run.
 *
 * `importId` names the import, so a retry of one that already landed writes
 * nothing: every message it writes carries {@link importedTurnId}, and a
 * transcript that holds one is never written again.
 *
 * `at` is where the lines go: after everything the transcript holds (the
 * default), or before it, for lines that were said before anything else there
 * (a first-run onboarding whose import lands only after the chat moved on).
 */
export const ConversationImportRequestSchema = z.strictObject({
  importId: z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,127}$/),
  at: z.enum(["start", "end"]).optional(),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8_000),
      }),
    )
    .min(1)
    .max(500),
});
export type ConversationImportRequest = z.infer<
  typeof ConversationImportRequestSchema
>;
export type ConversationImportMessage =
  ConversationImportRequest["messages"][number];

/** What an import answers. `imported` is 0 when the import had already landed. */
export interface ConversationImportResult {
  ok: true;
  imported: number;
}

/** The `code` a 400 carries when the body is not a {@link ConversationImportRequest}. */
export const CONVERSATION_IMPORT_INVALID = "invalid_import";

export function parseConversationImportRequest(
  body: unknown,
): ConversationImportRequest | null {
  const parsed = ConversationImportRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** The turn id an imported message carries: the import's name, then its place. */
export function importedTurnId(importId: string, index: number): string {
  return `import:${importId}:${index}`;
}

/** Whether `messages` already hold a message of the import named `importId`. */
export function holdsImport(
  messages: readonly ChatMessage[],
  importId: string,
): boolean {
  const prefix = `import:${importId}:`;
  return messages.some((message) => message.turnId?.startsWith(prefix));
}

/**
 * The import's messages as transcript entries, stamped `ts`. Each gets its
 * own turn id, so no two imported entries read as one turn.
 */
export function importedMessages(
  request: ConversationImportRequest,
  ts: number,
): ChatMessage[] {
  return request.messages.map((message, index) => ({
    role: message.role,
    content: message.content,
    ts,
    turnId: importedTurnId(request.importId, index),
  }));
}
