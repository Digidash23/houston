import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { HydrateManifestEntry } from "./hydrate";
import { keepsMergeBase } from "./sync-back-doc-merge";

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** The previous bytes, only while they provably are the ones `entry` names. */
export function trustedBase(entry: HydrateManifestEntry | undefined) {
  const base = entry?.mergeBase;
  return base !== undefined && sha256(base) === entry?.hash ? base : undefined;
}

/**
 * Keep the bytes just uploaded as the next pass's merge base. Read after the
 * upload, they are trusted only if they still hash to what was uploaded.
 */
export async function withMergeBase(
  abs: string,
  relativePath: string,
  entry: HydrateManifestEntry,
): Promise<HydrateManifestEntry> {
  if (!keepsMergeBase(relativePath)) return entry;
  try {
    const body = await readFile(abs, "utf8");
    return sha256(body) === entry.hash ? { ...entry, mergeBase: body } : entry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return entry;
    throw error;
  }
}
