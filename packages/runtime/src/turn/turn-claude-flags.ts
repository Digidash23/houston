import { join, posix } from "node:path";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import {
  readClaudeConfigFlags,
  readClaudeFlagCacheFile,
  sameClaudeFlags,
  seedClaudeConfigFlags,
  writeClaudeFlagCacheFile,
} from "../backends/claude/flag-cache";
import { CLAUDE_FLAGS_DIR, claudeFlagsFileName } from "./claude-flags-path";
import { turnClaudeLayout } from "./turn-backend";

/*
 * The acting member's Claude CLI flag cache (backends/claude/flag-cache),
 * carried across turns in the agent's store, one file per (agent, member)
 * (./claude-flags-path). Hydration admits only the acting member's file
 * (turn-hot-set), the seed reads only it, and only it is written back.
 * Sync-back never writes it: the refreshed cache is uploaded on its own, so a
 * store that does not admit the path yet costs that upload, never the turn's
 * sync.
 */

const warn = (what: string) => (reason: string) =>
  console.warn(`[claude-flags] ${what}: ${reason}`);

/**
 * The upload rides beside sync-back and the turn's terminal frame waits for
 * both, so it gets a deadline sync-back does not: a stalled store costs the
 * cache, never the finished turn.
 */
const UPLOAD_DEADLINE_MS = 5_000;

/**
 * Hand the member's stored cache to the conversation's Claude config dir
 * before the CLI starts. Best-effort: without it the CLI fetches its flags
 * itself, as it always did.
 */
export function seedTurnClaudeFlags(input: {
  dataDir: string;
  configDir: string;
  userId: string | undefined;
}): void {
  if (!input.userId) return;
  const stored = readClaudeFlagCacheFile(
    join(input.dataDir, CLAUDE_FLAGS_DIR, claudeFlagsFileName(input.userId)),
    warn("ignoring the stored flag cache"),
  );
  if (!stored) return;
  try {
    seedClaudeConfigFlags(input.configDir, stored);
  } catch (error) {
    warn("could not seed the flag cache")(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Store the cache the CLI refreshed during this turn, when it differs from
 * the one the member already has. Never rejects: a failed upload is reported
 * and the next turn simply starts without the newer values.
 */
export async function persistTurnClaudeFlags(input: {
  store: ObjectStore;
  prefix: string;
  filesystem: { dataDir: string; dataRel: string };
  root: string;
  conversationId: string;
  userId: string | undefined;
  deadlineMs?: number;
}): Promise<void> {
  if (!input.userId) return;
  const { dataDir, dataRel } = input.filesystem;
  const fresh = readClaudeConfigFlags(
    turnClaudeLayout(input.root, dataDir, input.conversationId).configDir,
    warn("unreadable Claude config"),
  );
  if (!fresh) return;
  const name = claudeFlagsFileName(input.userId);
  // A corrupt stored copy was reported when the seed read it; the fresh
  // cache replaces it below.
  const stored = readClaudeFlagCacheFile(
    join(dataDir, CLAUDE_FLAGS_DIR, name),
    () => {},
  );
  if (stored && sameClaudeFlags(stored, fresh)) return;
  const rel = posix.join(dataRel, CLAUDE_FLAGS_DIR, name);
  try {
    // Staged outside the hydrated tree, so sync-back never sees it.
    const staged = join(input.root, `claude-flags-${name}`);
    writeClaudeFlagCacheFile(staged, fresh);
    const deadline = AbortSignal.timeout(
      input.deadlineMs ?? UPLOAD_DEADLINE_MS,
    );
    // The signal cancels an HTTP upload; the race also bounds a store that
    // cannot be cancelled.
    await Promise.race([
      input.store.upload(
        staged,
        input.prefix ? posix.join(input.prefix, rel) : rel,
        { signal: deadline },
      ),
      new Promise<never>((_resolve, reject) =>
        deadline.addEventListener("abort", () => reject(deadline.reason), {
          once: true,
        }),
      ),
    ]);
  } catch (error) {
    warn("could not store the flag cache")(
      error instanceof Error ? error.message : String(error),
    );
  }
}
