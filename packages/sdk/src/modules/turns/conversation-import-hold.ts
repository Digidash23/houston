import type { ConversationImportResult } from "@houston/protocol";
import type { PageLifecycle } from "../../ports";
import { classifyImportFailure } from "./conversation-import-abort";
import type { PendingConversationImport } from "./conversation-import-outbox";

/**
 * Imports the page abandoned mid-flight, kept until the page is live again.
 *
 * An import aborted because the document was leaving is neither landed nor
 * failed: nothing is known. The promise the caller holds stays pending, and
 * when the lifecycle port says the page is live after all (a back/forward
 * cache restore; a `beforeunload` no unload followed, which the port reports
 * once its flag resets) the import is sent again and the promise settles on
 * that answer. A page that really left never fires `onLive`, so its promise
 * never settles, which costs a dead page nothing; the import is still owed
 * (the outbox) and the next load sends it. One hold per import: a second ask
 * for the same (agent, conversation, importId) joins the first.
 */
export type ImportSender = (
  entry: PendingConversationImport,
) => Promise<ConversationImportResult>;

interface Held {
  entry: PendingConversationImport;
  resolve: (result: ConversationImportResult) => void;
  reject: (err: unknown) => void;
}

const keyOf = (e: PendingConversationImport): string =>
  `${e.agentId}\n${e.conversationId}\n${e.request.importId}`;

export function createConversationImportHold(
  lifecycle: PageLifecycle,
  send: ImportSender,
  /** Cross the import off or keep it owed, as the outbox does after a send. */
  settle: (
    entry: PendingConversationImport,
    failure?: unknown,
  ) => Promise<void>,
) {
  const held = new Map<
    string,
    { promise: Promise<ConversationImportResult>; waiter: Held }
  >();
  // Subscribed on the first hold and kept: the module lives as long as the
  // SDK, and a hold can open at any later point.
  let listening = false;

  const resend = async (waiter: Held): Promise<void> => {
    const { entry } = waiter;
    try {
      const result = await send(entry);
      await settle(entry);
      held.delete(keyOf(entry));
      waiter.resolve(result);
    } catch (err) {
      await settle(entry, err);
      // Leaving again mid-resend: stay held for the next `onLive`.
      if (classifyImportFailure(err, lifecycle.isUnloading()) === "aborted")
        return;
      held.delete(keyOf(entry));
      waiter.reject(err);
    }
  };

  const onLive = () => {
    for (const { waiter } of [...held.values()]) void resend(waiter);
  };

  /** Hold `entry`; resolves or rejects with the eventual resend's answer. */
  const hold = (
    entry: PendingConversationImport,
  ): Promise<ConversationImportResult> => {
    const existing = held.get(keyOf(entry));
    if (existing) return existing.promise;
    let waiter!: Held;
    const promise = new Promise<ConversationImportResult>((resolve, reject) => {
      waiter = { entry, resolve, reject };
    });
    held.set(keyOf(entry), { promise, waiter });
    if (!listening) {
      listening = true;
      lifecycle.onLive(onLive);
    }
    return promise;
  };

  /** The hold already open for `entry`, if any: a second ask joins it. */
  const pending = (
    entry: PendingConversationImport,
  ): Promise<ConversationImportResult> | null =>
    held.get(keyOf(entry))?.promise ?? null;

  return { hold, pending };
}
