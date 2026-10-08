import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FENCE_RETIRED_MARKER, type RetireMarker } from "./daemon-hydrate";
import type { StoreSyncOptions } from "./daemon-policy";
import { WriteFence } from "./write-fence";

/**
 * The daemon's write fence. Right before the pod retires (the holder is
 * stale) it leaves a marker in its local tree naming every path its sync had
 * seen in the store: the kubelet restarts the container in place on the same
 * emptyDir, and the next boot must not upload a file the store dropped since
 * (a conversation a pool op deleted, say) under its fresh lease. runHydrate
 * prunes exactly those; a file the store never had is this pod's own unsynced
 * write and is kept.
 */
export function createDaemonFence(
  opts: StoreSyncOptions,
  halt: (err: { message: string }) => void,
  syncedKeys: () => Iterable<string>,
): WriteFence {
  return new WriteFence({
    probe: opts.leaseProbe,
    claimed: opts.leaseClaimed,
    heartbeatMs: opts.leaseHeartbeatMs,
    onLost: halt,
    onHolder: (holder) => {
      if (holder === "stale") markRetired(opts, syncedKeys());
      opts.onFenceLost?.(holder);
    },
    log: opts.log,
  });
}

function markRetired(opts: StoreSyncOptions, synced: Iterable<string>): void {
  const marker: RetireMarker = {
    retiredAt: new Date().toISOString(),
    synced: [...synced],
  };
  try {
    writeFileSync(
      join(opts.rootDir, FENCE_RETIRED_MARKER),
      JSON.stringify(marker),
    );
  } catch (err) {
    opts.log(
      "[store-sync] could not mark the fence retire; the next boot keeps local files the store lacks",
      err,
    );
  }
}
