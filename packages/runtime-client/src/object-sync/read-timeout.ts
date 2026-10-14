import type { ObjectStore, ReadOptions } from "./object-store";

/** The read error a store call that outlived its deadline rejects with. */
export class StoreReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`store read gave up after ${timeoutMs} ms`);
    this.name = "StoreReadTimeoutError";
  }
}

/** The slowest pace a read that is still making progress is assumed to keep
 *  (~1 MB/s): each listed byte adds this much time to the deadline. */
const SLOWEST_PROGRESS_BYTES_PER_MS = 1_024;
/** The most a batched read carries: pod-store answers larger objects
 *  `fallback` (read one by one later) and caps the body
 *  (cloud internal/podstore/batch.go). */
const BATCH_OBJECT_BYTES = 8 * 1024 * 1024;
const BATCH_BODY_BYTES = 64 * 1024 * 1024;

/**
 * Hydration's reads through `store`, each bounded to `timeoutMs` (retries
 * included) plus time for the bytes the listing says it carries
 * (`sizeOf`), so a large object downloading slowly is not mistaken for a
 * stalled one: a stalled read rejects instead of hanging, and the caller's
 * own signal still cancels at once.
 */
export function withReadTimeout(
  store: Pick<ObjectStore, "download" | "downloadMany">,
  timeoutMs: number,
  sizeOf: (key: string) => number | undefined = () => undefined,
): Pick<ObjectStore, "download" | "downloadMany"> {
  const bounded = (bytes: number, opts?: ReadOptions): ReadOptions => {
    const limitMs =
      timeoutMs + Math.ceil(bytes / SLOWEST_PROGRESS_BYTES_PER_MS);
    const deadline = AbortSignal.timeout(limitMs);
    const timedOut = new AbortController();
    deadline.addEventListener(
      "abort",
      () => timedOut.abort(new StoreReadTimeoutError(limitMs)),
      { once: true },
    );
    return {
      ...opts,
      signal: opts?.signal
        ? AbortSignal.any([opts.signal, timedOut.signal])
        : timedOut.signal,
    };
  };
  const downloadMany = store.downloadMany?.bind(store);
  return {
    download: (key, destFile, opts) =>
      store.download(key, destFile, bounded(sizeOf(key) ?? 0, opts)),
    ...(downloadMany
      ? {
          downloadMany: (entries, opts) =>
            downloadMany(
              entries,
              bounded(
                Math.min(
                  BATCH_BODY_BYTES,
                  entries.reduce(
                    (sum, { key }) =>
                      sum + Math.min(sizeOf(key) ?? 0, BATCH_OBJECT_BYTES),
                    0,
                  ),
                ),
                opts,
              ),
            ),
        }
      : {}),
  };
}
