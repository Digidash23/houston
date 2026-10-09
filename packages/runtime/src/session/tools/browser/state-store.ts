import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicTempPath } from "@houston/protocol";
import type { BrowserContext } from "playwright-core";

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

/** The saved state's path when one exists and parses, else undefined. */
export async function readableState(path: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    JSON.parse(raw);
  } catch (error) {
    // A torn or hand-edited file must not stop the browser from opening; the
    // person signs in again and the next save replaces it.
    console.warn(
      `[browser] ignoring unreadable sign-in state at ${path}`,
      error,
    );
    return undefined;
  }
  return path;
}

/** Atomically replace the saved state with this context's (0600). */
export async function saveState(
  context: BrowserContext,
  path: string,
): Promise<void> {
  const state = await context.storageState({ indexedDB: true });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Two conversations may save at once; each needs its own scratch file.
  const tmp = atomicTempPath(path, `${process.pid}-${crypto.randomUUID()}`);
  await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
  await rename(tmp, path);
}
