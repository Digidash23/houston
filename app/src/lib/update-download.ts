import { osDownloadUpdate } from "./os-bridge";
import {
  applyDownloadEvent,
  type DownloadTally,
  EMPTY_DOWNLOAD_TALLY,
} from "./update-download-progress";
import { downloadAttemptBudget, type UpdateOrigin } from "./update-policy";

/**
 * Fetch a release's bytes into the shell's staging buffer with the attempt
 * budget its origin affords, folding the shell's byte events into the one
 * progress figure the surfaces show. Resolves to the staged bytes' resource
 * id; rejects with the shell's typed failure (`update-download-failure.ts`).
 */
export function downloadReleaseBytes(
  updateRid: number,
  origin: UpdateOrigin,
  onProgress: (progress: number | null) => void,
): Promise<number> {
  let tally: DownloadTally = EMPTY_DOWNLOAD_TALLY;
  return osDownloadUpdate(updateRid, downloadAttemptBudget(origin), (event) => {
    const next = applyDownloadEvent(tally, event);
    tally = next.tally;
    onProgress(next.progress);
  });
}
