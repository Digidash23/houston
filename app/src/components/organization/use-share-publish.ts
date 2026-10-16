import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCapabilities } from "../../hooks/use-capabilities";
import { logAndReportError } from "../../lib/error-report";
import { tauriOrg } from "../../lib/tauri";
import { renderShareLinkCard } from "./org-chart-share-link-card";
import { shareTitle } from "./org-chart-share-model";
import {
  createSharePublisher,
  publishFor,
  SHARE_PUBLISH_IDLE,
  type SharePublish,
} from "./org-chart-share-publish";
import type { OrgTree } from "./org-chart-tree";

/**
 * The chart's page for the share dialog (`createSharePublisher`): nothing is
 * published until `start()` (the first click on Share on LinkedIn). It
 * follows the drawn `file`, so a redraw drops a page made for the old one,
 * and closing the dialog (`open` false) aborts an upload under way.
 * `publish` is always the state of the drawing on screen.
 */
export function useSharePublish(
  tree: OrgTree,
  open: boolean,
  file: File | null,
) {
  const { t } = useTranslation("teams");
  const { capabilities } = useCapabilities();
  const live = useRef(true);
  const [state, setState] = useState<SharePublish>(SHARE_PUBLISH_IDLE);
  const [publisher] = useState(() =>
    createSharePublisher(
      { publish: tauriOrg.publishChartShare, report: logAndReportError },
      (next) => {
        if (live.current) setState(next);
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

  useEffect(() => publisher.follow(file), [publisher, file]);
  useEffect(() => {
    if (!open) publisher.end();
  }, [publisher, open]);

  const start = useCallback(() => {
    if (!file) return;
    publisher.start({
      image: file,
      title: shareTitle(tree),
      card: (image) =>
        renderShareLinkCard(image, {
          tagline: t("orgChart.share.linkCardTagline"),
          call: t("orgChart.share.linkCardCall"),
        }),
      deployment: capabilities,
    });
  }, [publisher, file, tree, t, capabilities]);

  // Read against the drawing on screen, so a render between a redraw and
  // `follow` never offers the old page.
  return { publish: publishFor(state, file), start };
}
