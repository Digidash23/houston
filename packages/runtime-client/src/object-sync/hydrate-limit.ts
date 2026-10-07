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

/**
 * A deferred object lands after its caller has moved on, too late to refuse
 * the whole hydration cleanly, so a hydration that defers checks the cap
 * against the listed sizes before anything downloads. Unsized entries count
 * as zero; the download-time check still bounds them.
 */
export function assertListedWithinCap(
  entries: readonly { rel: string }[],
  sizes: ReadonlyMap<string, number>,
  maxBytes: number,
): void {
  let listed = 0;
  for (const { rel } of entries) listed += sizes.get(rel) ?? 0;
  if (listed > maxBytes) throw new HydrateLimitError(maxBytes, listed);
}
