import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCapabilities } from "../../hooks/use-capabilities";
import { reserveBrowserTab } from "../../lib/browser-tab";
import { logAndReportError } from "../../lib/error-report";
import { openExternalUrl } from "../../lib/open-external-url";
import { tauriOrg } from "../../lib/tauri";
import { renderShareLinkCard } from "./org-chart-share-link-card";
import {
  createLinkedInShare,
  LINKEDIN_SHARE_IDLE,
  type LinkedInShareState,
} from "./org-chart-share-linkedin";
import { shareTitle } from "./org-chart-share-model";
import {
  publishPage,
  type SharePublishJob,
} from "./org-chart-share-publish-page";
import type { OrgTree } from "./org-chart-tree";
import { shareCardText, shareCardWords } from "./use-share-card-image";

const PUBLISH_DEPS = {
  publish: tauriOrg.publishChartShare,
  report: logAndReportError,
};

/**
 * Share on LinkedIn for the share dialog (`createLinkedInShare`). It
 * follows the drawn `file`, so a redraw drops a page made for the old one,
 * and closing the dialog (`open` false) aborts a publish under way. A link
 * card drawn for a picture is kept for it, so a click after a failed
 * publish does not draw it again.
 */
export function useLinkedInShare(
  tree: OrgTree,
  open: boolean,
  file: File | null,
) {
  const { t } = useTranslation("teams");
  const { capabilities } = useCapabilities();
  const live = useRef(true);
  const cards = useRef(new WeakMap<File, Blob>());
  const [state, setState] = useState<LinkedInShareState>(LINKEDIN_SHARE_IDLE);
  const [share] = useState(() =>
    createLinkedInShare(
      {
        publish: (job, signal) => publishPage(PUBLISH_DEPS, job, signal),
        open: (url) => openExternalUrl(url, { command: "org_chart_share" }),
        reserve: () => reserveBrowserTab(),
        report: logAndReportError,
      },
      (next) => {
        if (live.current) setState(next);
      },
    ),
  );
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      share.end();
    };
  }, [share]);

  useEffect(() => share.follow(file), [share, file]);
  useEffect(() => {
    if (!open) share.end();
  }, [share, open]);

  const job = useCallback(
    (image: File): SharePublishJob => ({
      image,
      title: shareTitle(tree),
      card: async () => {
        const held = cards.current.get(image);
        if (held) return held;
        const card = await renderShareLinkCard(
          tree,
          shareCardText(tree, t),
          shareCardWords(t),
        );
        cards.current.set(image, card);
        return card;
      },
      deployment: capabilities,
    }),
    [tree, t, capabilities],
  );

  return { publishing: state.publishing !== null, click: share.click, job };
}
