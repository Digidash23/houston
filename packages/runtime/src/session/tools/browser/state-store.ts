import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicTempPath } from "@houston/protocol";
import {
  closePrivateDir,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  privateDirProblem,
  readPrivateFile,
} from "@houston/runtime-client/object-sync";
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
 * Owner-only on disk (0600 in a 0700 dir), here and wherever hydration lands
 * it (object-sync private-paths.ts): a pooled turn's tool user shares the
 * tree's group. PRODUCTION GAP: the cookies are plain JSON; they must be
 * encrypted at rest before this ships beyond a demo.
 */
export function browserStatePath(workspaceDir: string): string {
  return join(workspaceDir, ".houston", "browser", "state.json");
}

/** Refused state directories and files already logged: every open re-reads. */
const refusedLogged = new Set<string>();

/**
 * The saved state when one exists and parses, else undefined. A state
 * directory that is not a real directory this process owns (the tool user
 * shares `.houston/`'s group and could plant one with their own cookies) is
 * not read: no saved state, logged once. That check is only the cheap first
 * one: the directory can be swapped right after it, so the file itself is
 * opened without following a symlink, checked as a regular file this
 * process owns, and read through that same descriptor (readPrivateFile).
 */
export async function readState(
  path: string,
): Promise<StorageState | undefined> {
  if (!(await stateDirTrusted(dirname(path)))) return undefined;
  const read = await readPrivateFile(path);
  if (read.kind === "missing") return undefined;
  if (read.kind === "refused") {
    logRefusal(path, read.problem);
    return undefined;
  }
  const raw = read.body.toString("utf8");
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

async function stateDirTrusted(dir: string): Promise<boolean> {
  let problem: string | null;
  try {
    problem = await privateDirProblem(dir);
  } catch (error) {
    // No directory, no saved state: the plain first-sign-in case.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (problem === null) return true;
  logRefusal(dir, problem);
  return false;
}

function logRefusal(path: string, problem: string): void {
  if (refusedLogged.has(`${path} ${problem}`)) return;
  refusedLogged.add(`${path} ${problem}`);
  console.error(`[browser] not reading sign-in state: ${path} ${problem}`);
}

/** One context's view of the saved sign-ins: what it last read or wrote. */
export interface StateHolder {
  context: BrowserContext;
  statePath: string;
  base: StorageState;
  /**
   * What of this context may be saved; all of it when unset. A backup tab
   * keeps to its site, so a visit there never overwrites another site's
   * sign-in it was not given.
   */
  scope?: (state: StorageState) => StorageState;
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
  const all = await holder.context.storageState({ indexedDB: true });
  const ours = holder.scope ? holder.scope(all) : all;
  const theirs = (await readState(holder.statePath)) ?? EMPTY_STATE;
  const merged = mergeStorageState(holder.base, ours, theirs);
  if (!(await ensureStateDir(holder.statePath))) return;
  const tmp = atomicTempPath(
    holder.statePath,
    `${process.pid}-${crypto.randomUUID()}`,
  );
  await writeFile(tmp, JSON.stringify(merged), {
    mode: PRIVATE_FILE_MODE,
    flag: "wx",
  });
  await rename(tmp, holder.statePath);
  holder.base = ours;
}

/**
 * Creates `.houston/browser/` and nothing above it, and closes one hydration
 * or an older build left open (the EEXIST case keeps its old mode), and
 * refuses one that is not a real directory this process owns. A missing `.houston/`
 * means the workspace is gone (a pooled turn's root already removed): the
 * save is dropped with a warning instead of recreating a workspace that would
 * hold plaintext cookies nobody cleans up.
 */
async function ensureStateDir(statePath: string): Promise<boolean> {
  try {
    await mkdir(dirname(statePath), { mode: PRIVATE_DIR_MODE });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.warn("[browser] the workspace is gone; sign-ins not saved");
      return false;
    }
    if (code !== "EEXIST") throw error;
  }
  // A symlink or a directory the tool user made: refused and logged there.
  return closePrivateDir(statePath);
}
