import type { ConversationImportResult } from "@houston/protocol";
import type { Clock, PageLifecycle } from "../../ports";
import { classifyImportFailure } from "./conversation-import-abort";
import type { PendingConversationImport } from "./conversation-import-outbox";

/**
 * Imports the page abandoned mid-flight, kept until they can be sent again.
 *
 * An import aborted because the document was leaving is neither landed nor
 * failed: nothing is known. The promise the caller holds stays pending, and
 * the import is sent again when the page proves to be alive: the lifecycle
 * port says so (`onLive`: a back/forward-cache restore, a cancelled
 * navigation), or the hold's own timer fires. Timers do not run on a dead
 * page and pause in the back/forward cache, so a timer that fires IS the
 * page being alive, whatever the port's flag says (a `pagehide` with no
 * `pageshow` after it would otherwise leave the flag stuck). A page that
 * really left never settles its promise, which costs it nothing; the import
 * is still owed (the outbox) and the next load sends it.
 *
 * The hold only ever opens on a page that was leaving, so a resend that gets
 * no answer from the host (a transport drop, which is also what the browser
 * reports for a request the leaving page aborted) stays held and tries again
 * on the next timer; only the host's own answer settles it. One hold per
 * import: a second ask for the same (agent, conversation, importId) joins
 * the first, and one resend in flight at a time.
 */
export type ImportSender = (
  entry: PendingConversationImport,
) => Promise<ConversationImportResult>;

/** How long a hold waits before sending again on its own. Long enough that
 *  a reload's commit has aborted the page (nothing legitimate runs on it
 *  after that), short enough that a person who stayed is not kept waiting. */
export const RESEND_AFTER_MS = 3_000;

interface Held {
  entry: PendingConversationImport;
  promise: Promise<ConversationImportResult>;
  resolve: (result: ConversationImportResult) => void;
  reject: (err: unknown) => void;
  sending: boolean;
  timer: number | null;
}

const keyOf = (e: PendingConversationImport): string =>
  `${e.agentId}\n${e.conversationId}\n${e.request.importId}`;

export function createConversationImportHold(
  lifecycle: PageLifecycle,
  clock: Clock,
  send: ImportSender,
  /** Cross the import off or keep it owed, as the outbox does after a send. */
  settle: (
    entry: PendingConversationImport,
    failure?: unknown,
  ) => Promise<void>,
) {
  const held = new Map<string, Held>();
  // Subscribed while anything is held, released when the map empties: an SDK
  // instance is rebuilt on every bearer rotation and must not pile listeners.
  let stopListening: (() => void) | null = null;

  const arm = (h: Held) => {
    if (h.timer !== null) clock.clearTimeout(h.timer);
    h.timer = clock.setTimeout(() => {
      h.timer = null;
      void resend(h);
    }, RESEND_AFTER_MS);
  };

  const release = (h: Held) => {
    if (h.timer !== null) clock.clearTimeout(h.timer);
    held.delete(keyOf(h.entry));
    if (held.size === 0) {
      stopListening?.();
      stopListening = null;
    }
  };

  const resend = async (h: Held): Promise<void> => {
    if (h.sending) return;
    h.sending = true;
    if (h.timer !== null) {
      clock.clearTimeout(h.timer);
      h.timer = null;
    }
    try {
      const result = await send(h.entry);
      await settle(h.entry);
      release(h);
      h.resolve(result);
    } catch (err) {
      await settle(h.entry, err);
      // Only the host's answer settles a hold; no answer means try again.
      if (classifyImportFailure(err, true) === "aborted") {
        h.sending = false;
        arm(h);
        return;
      }
      release(h);
      h.reject(err);
    }
  };

  const onLive = () => {
    for (const h of [...held.values()]) void resend(h);
  };

  /** Hold `entry`; resolves or rejects with the eventual resend's answer. */
  const hold = (
    entry: PendingConversationImport,
  ): Promise<ConversationImportResult> => {
    const existing = held.get(keyOf(entry));
    if (existing) return existing.promise;
    let resolve!: Held["resolve"];
    let reject!: Held["reject"];
    const promise = new Promise<ConversationImportResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const h: Held = {
      entry,
      promise,
      resolve,
      reject,
      sending: false,
      timer: null,
    };
    held.set(keyOf(entry), h);
    stopListening ??= lifecycle.onLive(onLive);
    arm(h);
    return promise;
  };

  /** The hold already open for `entry`, if any: a second ask joins it. */
  const pending = (
    entry: PendingConversationImport,
  ): Promise<ConversationImportResult> | null =>
    held.get(keyOf(entry))?.promise ?? null;

  return { hold, pending };
}
