import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FENCE_RETIRED_MARKER } from "./daemon-hydrate";
import type { StoreSyncOptions } from "./daemon-policy";
import { WriteFence } from "./write-fence";

/**
 * The daemon's write fence. Right before the pod retires (the holder is
 * stale) it leaves a marker in its local tree: the kubelet restarts the
 * container in place on the same emptyDir, and the next boot must not upload
 * local files the store no longer holds (a conversation a pool op deleted,
 * say) under its fresh lease. runHydrate prunes them when it finds the marker.
 */
export function createDaemonFence(
  opts: StoreSyncOptions,
  halt: (err: { message: string }) => void,
): WriteFence {
  return new WriteFence({
    probe: opts.leaseProbe,
    claimed: opts.leaseClaimed,
    heartbeatMs: opts.leaseHeartbeatMs,
    onLost: halt,
    onHolder: (holder) => {
      if (holder === "stale") markRetired(opts);
      opts.onFenceLost?.(holder);
    },
    log: opts.log,
  });
}

function markRetired(opts: StoreSyncOptions): void {
  try {
    writeFileSync(
      join(opts.rootDir, FENCE_RETIRED_MARKER),
      new Date().toISOString(),
    );
  } catch (err) {
    opts.log(
      "[store-sync] could not mark the fence retire; the next boot keeps local files the store lacks",
      err,
    );
  }
}
