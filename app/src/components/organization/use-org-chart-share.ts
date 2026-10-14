import { isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { analytics } from "../../lib/analytics";
import { logAndReportError } from "../../lib/error-report";
import { openExternalUrl } from "../../lib/open-external-url";
import { saveBlob } from "../../lib/save-blob";
import { useUIStore } from "../../stores/ui";
import { type ShareChannel, sharePostText } from "./org-chart-share-model";
import { type ShareOutcome, shareOrgChart } from "./org-chart-share-run";
import type { OrgTree } from "./org-chart-tree";
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
 * click (`useShareCardImage`), so the click only hands it on. Afterwards a
 * toast says where the image went, and carries LinkedIn's link when the
 * browser blocked the tab. Unexpected failures report and show nothing.
 */
export function useOrgChartShare(tree: OrgTree, phone: boolean) {
  const { t } = useTranslation("teams");
  const image = useShareCardImage(tree);

  const land = (outcome: ShareOutcome) => {
    if (outcome.kind === "native") track("native", tree);
    if (outcome.kind !== "linkedin") return;
    if (outcome.opened)
      track(outcome.image === "saved" ? "linkedin_download" : "linkedin", tree);
    // The desktop shell has no popup blocker: a refusal there already
    // explained itself in its own toast.
    const blocked = !outcome.opened && !isTauri();
    const copy =
      outcome.image === "copied"
        ? "copied"
        : outcome.image === "saved"
          ? "saved"
          : null;
    if (!copy && !blocked) return;
    useUIStore.getState().addToast({
      variant: "info",
      title: t(
        copy ? `orgChart.share.${copy}` : "orgChart.share.linkedInBlocked",
      ),
      action: blocked
        ? {
            label: t("orgChart.share.openLinkedIn"),
            onClick: () => void openExternalUrl(outcome.url),
          }
        : undefined,
    });
  };

  return () => {
    const drawing = image();
    shareOrgChart({
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
  };
}
