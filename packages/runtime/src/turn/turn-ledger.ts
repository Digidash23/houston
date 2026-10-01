import { mkdtemp, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import type { TokenUsage } from "@houston/runtime-client";
import {
  ObjectNotFoundError,
  type ObjectStore,
  StoreConflictError,
} from "@houston/runtime-client/object-sync";
import { recordTokenSpend } from "../ai/usage/ledger";

/** The ledger's name in the runtime data dir (ai/usage/ledger.ts). */
const LEDGER_FILE = "token-usage.json";

/** Concurrent turns of one agent that may land between a read and a write. */
const MAX_ATTEMPTS = 4;

/**
 * Fold one pooled turn's spend into the agent's stored token ledger, the same
 * file and the same fold a standing pod writes after every turn
 * (`recordTokenSpend`), so `GET /providers/usage` reports E2B turns too.
 *
 * Written straight to the store, never through the turn's sync-back: two
 * conversations of one agent can run pooled at once, and a whole-file upload
 * of each turn's hydrated copy would keep only the last one's spend. Each
 * attempt reads the stored object with its generation, folds this turn's
 * usage onto THAT copy, and writes only if nobody wrote since; a lost race
 * re-reads and folds again, so a concurrent spend is neither lost nor counted
 * twice. A fenced claim (another worker adopted the turn) writes nothing.
 *
 * Display only (the usage meter of API-key providers), never billing: a
 * failure is logged and the turn it accounts for is never failed.
 */
export async function recordPooledTokenSpend(input: {
  store: ObjectStore;
  prefix: string;
  /** The runtime data dir, relative to the store root. */
  dataRel: string;
  provider: string;
  usage: TokenUsage;
  /** Where the ledger's working copy is written; outside the synced tree. */
  scratchDir: string;
}): Promise<void> {
  const rel = posix.join(input.dataRel, LEDGER_FILE);
  const key = input.prefix ? posix.join(input.prefix, rel) : rel;
  const work = await mkdtemp(join(input.scratchDir, "ledger-"));
  const local = join(work, LEDGER_FILE);
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const generation = await readLedger(input.store, key, local);
      recordTokenSpend(input.provider, input.usage, work);
      try {
        await input.store.upload(local, key, {
          ...(generation !== null ? { ifGenerationMatch: generation } : {}),
        });
        return;
      } catch (error) {
        if (error instanceof StoreConflictError && attempt < MAX_ATTEMPTS)
          continue;
        throw error;
      }
    }
  } catch (error) {
    console.warn(
      `[usage-ledger] pooled turn spend for ${input.provider} not recorded (${key}): ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Download the stored ledger to `local` and return the generation a write
 * must match: "0" (create-only) when there is none yet, null when the store
 * keeps no generations and the write can only be unconditional.
 */
async function readLedger(
  store: ObjectStore,
  key: string,
  local: string,
): Promise<string | null> {
  await rm(local, { force: true });
  try {
    if (!store.downloadVersioned) {
      await store.download(key, local);
      return null;
    }
    return (await store.downloadVersioned(key, local)).generation ?? null;
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
    // A failed read can leave an empty file behind: the fold starts fresh.
    await rm(local, { force: true });
    return store.downloadVersioned ? "0" : null;
  }
}
