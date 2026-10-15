import type { StreamRegistry } from "./stream-registry";

/** How many times a read a turn overtook is taken again before giving up. */
export const OVERTAKEN_READ_RETRIES = 2;

/** One history read and the {@link StreamRegistry.turnsStarted} count it went
 *  out at. A seed compares `mark` with the count now: equal means no turn this
 *  owner started is missing from `value`. */
export interface MarkedRead<T> {
  value: T;
  mark: number;
}

/**
 * Read a conversation's history no older than the turns this owner started
 * on it. A read that a send overtook answers with the transcript from before
 * that turn; seeding it over the feed would replace the turn on screen. So it
 * is taken again, once the turn's stream has let go of the conversation: by
 * then the host holds the prompt and the reply, and the new read folds over
 * the feed as its newer superset.
 *
 * Waiting matters for the first read a chat opens on. Its caller (a query's
 * first fetch) joins every change event that lands while it is out, so this
 * read is the only one the chat gets until the next change.
 *
 * Bounded by {@link OVERTAKEN_READ_RETRIES}: past it the last read comes back
 * with the mark it went out at, and a seed refuses it.
 */
export async function readPastOwnTurns<T>(
  registry: StreamRegistry,
  key: string,
  read: () => Promise<T>,
): Promise<MarkedRead<T>> {
  for (let attempt = 0; ; attempt++) {
    const mark = registry.turnsStarted(key);
    const value = await read();
    if (
      registry.turnsStarted(key) === mark ||
      attempt >= OVERTAKEN_READ_RETRIES
    )
      return { value, mark };
    await ownTurnLetGo(registry, key);
  }
}

/** Resolves once no turn this owner sent holds `key`: neither a turn stream
 *  nor an observer still handing a send off. An observer watching someone
 *  else's turn is not waited on. */
async function ownTurnLetGo(
  registry: StreamRegistry,
  key: string,
): Promise<void> {
  const never = new AbortController().signal;
  for (;;) {
    const entry = registry.get(key);
    if (!entry) return;
    if (entry.kind !== "turn" && !registry.isSending(key)) return;
    await registry.left(key, entry, never);
  }
}
