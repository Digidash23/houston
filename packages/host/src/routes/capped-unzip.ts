import { unzipSync } from "fflate";

export type ZipLimitBreach = "too_many_entries" | "too_large";

export class ZipLimitError extends Error {
  constructor(readonly breach: ZipLimitBreach) {
    super(breach);
    this.name = "ZipLimitError";
  }
}

/**
 * Unzip an archive whose limits apply BEFORE anything inflates. fflate sizes
 * each deflated entry's output from the size the central directory declares
 * and never grows it (a longer stream is cut there), and a stored entry is a
 * slice of its compressed bytes. So the declared sizes summed in the filter
 * bound memory, even for an archive whose sizes lie. Directory entries are
 * dropped and not counted.
 */
export function unzipCapped(
  bytes: Uint8Array,
  limits: { maxEntries: number; maxUnpackedBytes: number },
): [string, Uint8Array][] {
  let entries = 0;
  let unpacked = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (file.name.endsWith("/")) return false;
      entries += 1;
      if (entries > limits.maxEntries)
        throw new ZipLimitError("too_many_entries");
      unpacked += file.compression === 0 ? file.size : file.originalSize;
      if (unpacked > limits.maxUnpackedBytes)
        throw new ZipLimitError("too_large");
      return true;
    },
  });
  return Object.entries(files);
}
