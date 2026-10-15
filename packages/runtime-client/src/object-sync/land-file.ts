import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { atomicTempPath } from "@houston/protocol";
import { landingMode, mkdirForLanding } from "./private-paths";

/**
 * Land what `open` reads at `destFile` atomically: a fresh temp sibling (exclusive
 * create, owner-only when private), then a rename that replaces whatever was
 * at `destFile` (a planted symlink included) instead of writing through it.
 * `open` runs only once the directory is ready, so a source that fails at
 * once (a missing file) fails inside the pipeline, never unheard. False when
 * the private directory was refused (private-paths.ts): nothing is opened and
 * nothing lands.
 */
export async function landStream(
  open: () => Readable,
  destFile: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!(await mkdirForLanding(destFile))) return false;
  const tempFile = atomicTempPath(destFile, randomUUID());
  try {
    await pipeline(
      open(),
      createWriteStream(tempFile, { ...landingMode(destFile), flags: "wx" }),
      ...(signal ? [{ signal }] : []),
    );
    await rename(tempFile, destFile);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
  }
  return true;
}
