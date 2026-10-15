import {
  conversationScope,
  type FeedFrame,
  type HistoryWindowVM,
  type MarkedRead,
  readPastOwnTurns,
  streamKey,
} from "@houston/sdk";
import { registry } from "./adapter-streams";
import { decideServerSeed, type SeedFrame } from "./history-window";
import { conversationStore, conversationVm } from "./vm";

/**
 * Where a conversation's turns stand, taken just BEFORE a history read goes
 * out and handed back to {@link seedConversationVm} with the read's fold.
 * It counts the turns this client started on the conversation, so a read that
 * a send overtook is told apart from one that went out after it.
 */
export function historyReadMark(agentPath: string, sessionKey: string): number {
  return registry.turnsStarted(streamKey(agentPath, sessionKey));
}

/** Whether a turn this client sent holds the conversation (the SDK's
 *  `StreamRegistry.ownsTurn` over this adapter's streams). */
export function ownTurnHolds(agentPath: string, sessionKey: string): boolean {
  return registry.ownsTurn(streamKey(agentPath, sessionKey));
}

/** The SDK's `readPastOwnTurns` over this adapter's streams: a history read
 *  a send of this client overtook is taken again once that turn let go. */
export function readPastOwnTurnsOn<T>(
  agentPath: string,
  sessionKey: string,
  read: () => Promise<T>,
): Promise<MarkedRead<T>> {
  return readPastOwnTurns(registry, streamKey(agentPath, sessionKey), read);
}

/**
 * Seed the conversation VM from a loaded history fold — unless a live turn or
 * observer already owns the conversation (that stream's feed IS the VM;
 * re-seeding would clobber its in-flight bubble), or the VM already holds a
 * feed the fold would make poorer. The guard is what makes a RACED history
 * read harmless: a load fired mid-turn can resolve just after settle (the
 * registry entry already released) carrying a fold persisted BEFORE the reply
 * — replacing the settled live feed with it would eat the reply.
 *
 * Two seed shapes (HOU-819):
 * - Cache paint (no `window`): the historical richer-wins length guard — the
 *   paint only ever fills an emptier VM.
 * - Windowed server read (`window` set): the fold is a TAIL, so it can be
 *   shorter than the feed yet strictly newer (a teammate's turn landed while
 *   this chat was closed and cache-painted) — {@link decideServerSeed}
 *   anchors on user-message content (never cross-clock timestamps), replaces
 *   on newer/richer, stamps the window without reseeding on identical
 *   content, and skips on poorer (or when the feed holds loaded pages /
 *   unconfirmed sends the fold lacks).
 *
 * `readMark` is {@link historyReadMark} as the read went out. A turn this
 * client started since then is on screen, or just settled there, and the
 * fold cannot hold it: the read answered before the turn's prompt was
 * persisted. Neither guard above catches that once the turn has settled and
 * the feed holds nothing but that turn (a chat opened as the turn was sent):
 * the fold and the feed share no prompt, which reads as a newer server tail,
 * and the fold would replace the turn. Only a read that went out after the
 * turn started may seed; a server read gets there through
 * {@link readPastOwnTurnsOn}. `null`: a read the client was torn down under.
 */
export function seedConversationVm(
  agentPath: string,
  sessionKey: string,
  frames: FeedFrame[],
  readMark: number | null,
  window?: HistoryWindowVM,
): void {
  const key = streamKey(agentPath, sessionKey);
  if (registry.get(key)) return;
  if (readMark === null || registry.turnsStarted(key) !== readMark) return;
  const current = conversationStore.getSnapshot(
    conversationScope(agentPath, sessionKey),
  ) as { feed?: SeedFrame[]; historyWindow?: HistoryWindowVM } | undefined;
  const curFeed = current?.feed ?? [];
  if (!window) {
    if (curFeed.length >= frames.length) return;
    conversationVm.seedHistory(agentPath, sessionKey, frames);
    return;
  }
  const decision = decideServerSeed(
    curFeed,
    frames,
    current?.historyWindow !== undefined,
  );
  if (decision === "replace") {
    conversationVm.seedHistory(agentPath, sessionKey, frames, window);
  } else if (decision === "stamp") {
    conversationVm.stampHistoryWindow(agentPath, sessionKey, window);
  }
}
