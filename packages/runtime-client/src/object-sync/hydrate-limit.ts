/** The hydrated prefix exceeded the caller's aggregate byte cap. */
export class HydrateLimitError extends Error {
  constructor(
    readonly maxBytes: number,
    readonly observedBytes: number,
  ) {
    super(
      `workspace exceeds the ${Math.round(maxBytes / 1024 / 1024)} MiB hydration limit`,
    );
    this.name = "HydrateLimitError";
  }
}

/** Listed bytes of `entries`; unsized entries count as zero (the
 *  download-time check still bounds them). */
export function listedBytes(
  entries: readonly { rel: string }[],
  sizes: ReadonlyMap<string, number>,
): number {
  let listed = 0;
  for (const { rel } of entries) listed += sizes.get(rel) ?? 0;
  return listed;
}

/**
 * A hydration that defers starts its caller's work before the deferred set
 * lands, so it refuses an over-cap critical set from the listed sizes before
 * anything downloads (so does one that asks for it, `capListed`). The
 * deferred set has its own budget and never counts here.
 */
export function assertListedWithinCap(
  entries: readonly { rel: string }[],
  sizes: ReadonlyMap<string, number>,
  maxBytes: number,
): void {
  const listed = listedBytes(entries, sizes);
  if (listed > maxBytes) throw new HydrateLimitError(maxBytes, listed);
}

/**
 * Split the admitted non-priority objects into the set the caller waits on
 * (`now`) and the deferred set, and check both against the listing. An
 * over-cap critical set (priority + `now`) throws before anything downloads.
 * An over-budget deferred set comes back as `deferredRefusal` for `deferred`
 * to reject with, so the critical set and the caller's work go on.
 */
export function splitDeferred<T extends { rel: string }>(opts: {
  critical: readonly T[];
  remaining: T[];
  defer?: (rel: string) => boolean;
  sizes: ReadonlyMap<string, number>;
  maxBytes: number;
  deferredMaxBytes: number;
  capListed?: boolean;
}): { now: T[]; later: T[]; deferredRefusal?: HydrateLimitError } {
  const defer = opts.defer;
  const later = defer ? opts.remaining.filter(({ rel }) => defer(rel)) : [];
  const now = later.length
    ? opts.remaining.filter(({ rel }) => !defer?.(rel))
    : opts.remaining;
  if (later.length || opts.capListed)
    assertListedWithinCap(
      [...opts.critical, ...now],
      opts.sizes,
      opts.maxBytes,
    );
  const laterListed = listedBytes(later, opts.sizes);
  return laterListed > opts.deferredMaxBytes
    ? {
        now,
        later,
        deferredRefusal: new HydrateLimitError(
          opts.deferredMaxBytes,
          laterListed,
        ),
      }
    : { now, later };
}
