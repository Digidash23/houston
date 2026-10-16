import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCapabilities } from "../../hooks/use-capabilities";
import { logAndReportError } from "../../lib/error-report";
import { tauriOrg } from "../../lib/tauri";
import { renderShareLinkCard } from "./org-chart-share-link-card";
import { shareTitle } from "./org-chart-share-model";
import {
  createSharePublisher,
  SHARE_PUBLISH_IDLE,
  type SharePublish,
} from "./org-chart-share-publish";
import type { OrgTree } from "./org-chart-tree";

/**
 * The chart's page for the share dialog's opening `session`
 * (`createSharePublisher`): published once `file` is drawn while `open`,
 * unless the phone's share sheet takes the image (`sheet`). A chart that
 * changes while the dialog is open keeps the page already under way.
 */
export function useSharePublish(
  tree: OrgTree,
  dialog: { open: boolean; session: number },
  file: File | null,
  sheet: boolean,
): SharePublish {
  const { t } = useTranslation("teams");
  const { capabilities } = useCapabilities();
  const live = useRef(true);
  const [publish, setPublish] = useState<SharePublish>(SHARE_PUBLISH_IDLE);
  const [publisher] = useState(() =>
    createSharePublisher(
      { publish: tauriOrg.publishChartShare, report: logAndReportError },
      (next) => {
        if (live.current) setPublish(next);
      },
    ),
  );
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      publisher.end();
    };
  }, [publisher]);

  const { open, session } = dialog;
  useEffect(() => {
    if (!open) {
      publisher.end();
      return;
    }
    if (!file || sheet) return;
    publisher.begin(session, {
      image: file,
      title: shareTitle(tree),
      card: (image) =>
        renderShareLinkCard(image, {
          tagline: t("orgChart.share.linkCardTagline"),
          call: t("orgChart.share.linkCardCall"),
        }),
      deployment: capabilities,
    });
  }, [open, session, file, sheet, tree, t, capabilities, publisher]);

  return publish;
}
