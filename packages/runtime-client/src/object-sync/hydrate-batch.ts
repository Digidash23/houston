import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileSha256 } from "./file-hash";
import type { HydrateManifest } from "./hydrate";
import type { HydrateDownloadState, HydrateEntry } from "./hydrate-download";
import type { ObjectStore } from "./object-store";
import { keepsMergeBase } from "./sync-back-doc-merge";

/** Keys per batched read, and batched reads in flight at once. */
const BATCH_KEYS = 128;
const BATCH_PARALLEL = 4;

/**
 * Land as many entries as the store will inline through `downloadMany`, one
 * round trip per chunk instead of per object. Returns the entries the store
 * answered `fallback` for, which the caller downloads one by one.
 */
export async function hydrateBatched(opts: {
  downloadMany: NonNullable<ObjectStore["downloadMany"]>;
  destDir: string;
  entries: HydrateEntry[];
  manifest: HydrateManifest;
  maxBytes: number;
  state: HydrateDownloadState;
  /** Keep the board's bytes as its merge base, as the one-by-one path does. */
  keepMergeBase?: boolean;
  signal: AbortSignal;
  limitError: (observedBytes: number) => Error;
}): Promise<HydrateEntry[]> {
  const chunks: HydrateEntry[][] = [];
  for (let index = 0; index < opts.entries.length; index += BATCH_KEYS) {
    chunks.push(opts.entries.slice(index, index + BATCH_KEYS));
  }
  const fallback: HydrateEntry[] = [];
  let next = 0;
  const worker = async () => {
    while (!opts.state.failed) {
      const chunk = chunks[next++];
      if (!chunk) return;
      try {
        await landChunk(opts, chunk, fallback);
      } catch (error) {
        opts.state.fail(error);
        return;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BATCH_PARALLEL, chunks.length) }, worker),
  );
  if (opts.state.failed) throw opts.state.firstError;
  return fallback;
}

async function landChunk(
  opts: Parameters<typeof hydrateBatched>[0],
  chunk: HydrateEntry[],
  fallback: HydrateEntry[],
) {
  const dest = (rel: string) => join(opts.destDir, ...rel.split("/"));
  const outcomes = await opts.downloadMany(
    chunk.map(({ key, rel }) => ({ key, destFile: dest(rel) })),
    { signal: opts.signal },
  );
  for (const entry of chunk) {
    if (opts.signal.aborted) return;
    const outcome = outcomes.get(entry.key);
    if (!outcome || outcome.status === "fallback") {
      fallback.push(entry);
      continue;
    }
    if (outcome.status === "missing") {
      await rm(dest(entry.rel), { force: true });
      continue;
    }
    const { size } = await stat(dest(entry.rel));
    opts.state.total += size;
    if (opts.state.total > opts.maxBytes) {
      throw opts.limitError(opts.state.total);
    }
    opts.manifest.set(entry.rel, {
      hash: await fileSha256(dest(entry.rel), size),
      generation: entry.generation,
      ...(opts.keepMergeBase && keepsMergeBase(entry.rel)
        ? { mergeBase: await readFile(dest(entry.rel), "utf8") }
        : {}),
    });
  }
}
