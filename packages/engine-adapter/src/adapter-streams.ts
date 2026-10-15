import { StreamRegistry } from "@houston/sdk";

/**
 * The web adapter's OWN stream set — module-scoped, so the single adapter keeps
 * exactly one registry (its historical global-singleton behavior) while an SDK
 * instance owns a separate one and the two never cross-abort. Threaded into
 * every SDK turn/observer call in `turn-stream.ts`, and read by the history
 * seed (`conversation-seed.ts`) to keep a read off a conversation a stream owns.
 */
export const registry = new StreamRegistry();
