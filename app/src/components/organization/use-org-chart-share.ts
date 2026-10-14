import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { analytics } from "../../lib/analytics";
import { logAndReportError } from "../../lib/error-report";
import { openExternalUrl } from "../../lib/open-external-url";
import { saveBlob } from "../../lib/save-blob";
import { useUIStore } from "../../stores/ui";
import { type ShareChannel, sharePostText } from "./org-chart-share-model";
import {
  type ShareOutcome,
  shareLanding,
  shareOrgChart,
} from "./org-chart-share-run";
import type { OrgTree } from "./org-chart-tree";
import { livePage, whenSeen } from "./org-chart-when-seen";
import { createSingleFlight } from "./single-flight";
import { useShareCardImage } from "./use-share-card-image";

/** Counts only: no names ride a share event. */
function track(channel: ShareChannel, tree: OrgTree) {
  analytics.track("org_chart_shared", {
    share_channel: channel,
    agent_count: tree.counts.agents,
    people_count: tree.counts.people,
  });
}

/**
 * The Share button: one click, no dialog. The image is drawn ahead of the
 * click (`useShareCardImage`), so the click only hands it on, and clicks
 * while a share is still running are ignored (a double click would open
 * LinkedIn twice). Afterwards a toast says where the image went, once the
 * person is back on this page, and carries LinkedIn's link when the
 * browser blocked the tab. Unexpected failures report and show nothing.
 */
export function useOrgChartShare(tree: OrgTree, phone: boolean) {
  const { t } = useTranslation("teams");
  const image = useShareCardImage(tree);
  const flight = useRef(createSingleFlight());
  const pending = useRef(new Set<() => void>());
  useEffect(() => {
    const cancels = pending.current;
    return () => {
      for (const cancel of cancels) cancel();
      cancels.clear();
    };
  }, []);

  const land = (outcome: ShareOutcome) => {
    const landing = shareLanding(outcome, isTauri());
    if (landing.channel) track(landing.channel, tree);
    const { toast, blocked } = landing;
    if (!toast) return;
    let shown = false;
    // A stop left in the set after its toast showed is a harmless no-op.
    const cancel = whenSeen(livePage(), () => {
      shown = true;
      useUIStore.getState().addToast({
        variant: "info",
        title: t(
          toast === "blocked"
            ? "orgChart.share.linkedInBlocked"
            : `orgChart.share.${toast}`,
        ),
        action:
          blocked && outcome.kind === "linkedin"
            ? {
                label: t("orgChart.share.openLinkedIn"),
                onClick: () => {
                  track(blocked, tree);
                  void openExternalUrl(outcome.url);
                },
              }
            : undefined,
      });
    });
    if (!shown) pending.current.add(cancel);
  };

  return () => {
    flight.current(() => share());
  };

  function share(): Promise<void> {
    const drawing = image();
    return shareOrgChart({
      post: sharePostText(t, tree),
      png: drawing.png,
      ready: drawing.ready,
      phone,
      sheet:
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function"
          ? {
              canShare: (data) => navigator.canShare(data),
              share: (data) => navigator.share(data),
            }
          : undefined,
      copyImage:
        typeof navigator.clipboard?.write === "function" &&
        typeof globalThis.ClipboardItem === "function"
          ? (png) =>
              navigator.clipboard.write([
                new ClipboardItem({ "image/png": png }),
              ])
          : undefined,
      open: openExternalUrl,
      save: async (file) => (await saveBlob(file.name, file)).kind === "saved",
      report: logAndReportError,
    })
      .then(land)
      .catch((error: unknown) => logAndReportError("org_chart_share", error));
  }
}
