import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicTempPath } from "@houston/protocol";
import type { BrowserContext } from "playwright-core";
import {
  EMPTY_STATE,
  isStorageState,
  mergeStorageState,
  type StorageState,
} from "./state-merge";

/**
 * Where an agent's website sign-ins live: cookies + localStorage + IndexedDB
 * as a Playwright storageState, NOT a Chromium profile directory. A pooled
 * turn syncs its workspace back to the store, and a profile would ship
 * Chromium's caches with it. `browser/` is not one of the Houston-owned
 * `.houston/` dirs, so a single-use turn carries it back like agent state.
 *
 * PRODUCTION GAP: the file holds live session cookies in plain JSON (0600
 * only). It must be encrypted at rest before this ships beyond a demo.
 */
export function browserStatePath(workspaceDir: string): string {
  return join(workspaceDir, ".houston", "browser", "state.json");
}

/** The saved state when one exists and parses, else undefined. */
export async function readState(
  path: string,
): Promise<StorageState | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // A torn or hand-edited file must not stop the browser from opening; the
    // person signs in again and the next save replaces it.
    console.warn(
      `[browser] ignoring unreadable sign-in state at ${path}`,
      error,
    );
    return undefined;
  }
  if (isStorageState(parsed)) return parsed;
  console.warn(`[browser] ignoring malformed sign-in state at ${path}`);
  return undefined;
}

/** One context's view of the saved sign-ins: what it last read or wrote. */
export interface StateHolder {
  context: BrowserContext;
  statePath: string;
  base: StorageState;
}

/** Saves per file, in order: each one reads the file the previous one wrote. */
const saving = new Map<string, Promise<void>>();

/**
 * Merge this context's changes into the saved state (state-merge.ts) and
 * replace the file atomically, owner-only. Serialized per path within the
 * process so two conversations' read-merge-write never interleave.
 */
export function saveState(holder: StateHolder): Promise<void> {
  const path = holder.statePath;
  const previous = saving.get(path) ?? Promise.resolve();
  const next = previous.then(() => writeMerged(holder));
  // The caller gets `next`'s failure; the chain only waits for it to settle.
  const release = () => {
    if (saving.get(path) === settled) saving.delete(path);
  };
  const settled: Promise<void> = next.then(release, release);
  saving.set(path, settled);
  return next;
}

async function writeMerged(holder: StateHolder): Promise<void> {
  const ours = await holder.context.storageState({ indexedDB: true });
  const theirs = (await readState(holder.statePath)) ?? EMPTY_STATE;
  const merged = mergeStorageState(holder.base, ours, theirs);
  if (!(await ensureStateDir(holder.statePath))) return;
  const tmp = atomicTempPath(
    holder.statePath,
    `${process.pid}-${crypto.randomUUID()}`,
  );
  await writeFile(tmp, JSON.stringify(merged), { mode: 0o600 });
  await rename(tmp, holder.statePath);
  holder.base = ours;
}

/**
 * Creates `.houston/browser/` and nothing above it. A missing `.houston/`
 * means the workspace is gone (a pooled turn's root already removed): the
 * save is dropped with a warning instead of recreating a workspace that would
 * hold plaintext cookies nobody cleans up.
 */
async function ensureStateDir(statePath: string): Promise<boolean> {
  try {
    await mkdir(dirname(statePath), { mode: 0o700 });
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return true;
    if (code !== "ENOENT") throw error;
    console.warn("[browser] the workspace is gone; sign-ins not saved");
    return false;
  }
}
