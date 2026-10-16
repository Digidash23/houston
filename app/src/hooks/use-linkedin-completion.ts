import type { LinkedInConnection } from "@houston/engine-adapter";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { showExpectedStateToast } from "../lib/error-toast";
import i18n from "../lib/i18n";
import { redeemLinkedIn } from "../lib/linkedin-completion";
import { tauriLinkedIn } from "../lib/linkedin-facade";
import { queryKeys } from "../lib/query-keys";
import { takeSlackCompletion } from "../lib/slack-completion";
import { useUIStore } from "../stores/ui";

/**
 * Redeem a LinkedIn connect's return wherever the app is when it lands: the
 * tab the web click claimed (which then says it can be closed), or the
 * desktop app the loopback or deep link focused. The connection goes into
 * the cache the share dialog reads, so its button turns to Post at once.
 */
export function useLinkedInCompletion() {
  const qc = useQueryClient();
  const queued = useUIStore((s) => s.pendingLinkedInCompletion);
  const clear = useUIStore((s) => s.setPendingLinkedInCompletion);
  useEffect(() => {
    if (!queued) return;
    const pending = takeSlackCompletion(
      () => useUIStore.getState().pendingLinkedInCompletion,
      () => clear(null),
    );
    if (!pending) return;
    void redeemLinkedIn(pending, {
      complete: tauriLinkedIn.complete,
      landed: (connection) =>
        qc.setQueryData<LinkedInConnection>(
          queryKeys.linkedInConnection(),
          connection,
        ),
      tell: (result) =>
        result === "connected"
          ? showExpectedStateToast(
              i18n.t("teams:orgChart.share.completion.connectedTitle"),
              i18n.t("teams:orgChart.share.completion.connectedBody"),
            )
          : showExpectedStateToast(
              i18n.t("teams:orgChart.share.completion.unredeemableTitle"),
              i18n.t("teams:orgChart.share.completion.unredeemableBody"),
            ),
    });
  }, [queued, clear, qc]);
}
