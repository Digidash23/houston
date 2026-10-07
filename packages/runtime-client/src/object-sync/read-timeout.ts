import type { ObjectStore, ReadOptions } from "./object-store";

/** The read error a store call that outlived its deadline rejects with. */
export class StoreReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`store read gave up after ${timeoutMs} ms`);
    this.name = "StoreReadTimeoutError";
  }
}

/**
 * Hydration's reads through `store`, each bounded to `timeoutMs` (retries
 * included): a stalled read rejects instead of hanging, and the caller's own
 * signal still cancels at once.
 */
export function withReadTimeout(
  store: Pick<ObjectStore, "download" | "downloadMany">,
  timeoutMs: number,
): Pick<ObjectStore, "download" | "downloadMany"> {
  const bounded = (opts?: ReadOptions): ReadOptions => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const timedOut = new AbortController();
    deadline.addEventListener(
      "abort",
      () => timedOut.abort(new StoreReadTimeoutError(timeoutMs)),
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
      store.download(key, destFile, bounded(opts)),
    ...(downloadMany
      ? {
          downloadMany: (entries, opts) => downloadMany(entries, bounded(opts)),
        }
      : {}),
  };
}
