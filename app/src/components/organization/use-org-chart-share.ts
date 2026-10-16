import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { analytics } from "../../lib/analytics";
import { logAndReportError } from "../../lib/error-report";
import { osIsNativeMobile } from "../../lib/os-bridge/platform";
import {
  canCopyImage,
  coarsePointer,
  copyImageToClipboard,
  downloadShareImage,
  shareSheet,
} from "./org-chart-share-browser";
import type { ShareDrawing } from "./org-chart-share-linkedin";
import { sharePostText } from "./org-chart-share-model";
import { type ShareLanding, shareRoute } from "./org-chart-share-run";
import {
  createLinkedInGate,
  INITIAL_SHARE_DIALOG,
  replacesShownImage,
  shareDialogReducer,
} from "./org-chart-share-state";
import { shareCounts, trackShare as track } from "./org-chart-share-track";
import type { OrgTree } from "./org-chart-tree";
import { useLinkedInShare } from "./use-linkedin-share";
import { useShareCardImage } from "./use-share-card-image";

/** How long Copy image reads "Copied". */
const COPIED_MS = 2000;

/**
 * The share dialog's state and actions over the image drawn ahead
 * (`useShareCardImage`) and Share on LinkedIn in one click
 * (`org-chart-share-linkedin.ts`). The click does its work inside the event
 * (a browser claims LinkedIn's tab there) and is gated
 * (`createLinkedInGate`: a double click would open LinkedIn twice); the
 * share sheet is left ungated, since a sheet that never settles would kill
 * the button and a second tap is already quiet.
 * Unexpected failures report and show nothing.
 */
export function useOrgChartShare(tree: OrgTree) {
  const { t } = useTranslation("teams");
  const { preview, file, retry, current } = useShareCardImage(tree);
  const [gate] = useState(() => createLinkedInGate(() => performance.now()));
  const [state, dispatch] = useReducer(
    shareDialogReducer,
    INITIAL_SHARE_DIALOG,
  );
  const session = useRef(state.session);
  session.current = state.session;
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimer();
    };
  }, [clearTimer]);
  const linkedInShare = useLinkedInShare(tree, state.open, file);

  // A redrawn image is a different picture: what was said about the old one
  // no longer holds. Only replacing a picture that was on screen resets: the
  // first image arriving must not wipe the line of a share started while it
  // was still drawing.
  const drawnUrl = preview.status === "ready" ? preview.url : null;
  const shownUrl = useRef<string | null>(null);
  useEffect(() => {
    const previous = shownUrl.current;
    shownUrl.current = drawnUrl;
    if (!replacesShownImage(previous, drawnUrl)) return;
    clearTimer();
    dispatch({ type: "redrawn", url: drawnUrl });
  }, [drawnUrl, clearTimer]);

  const setOpen = (next: boolean) => {
    if (next) {
      analytics.track("org_chart_share_opened", shareCounts(tree));
      clearTimer();
    }
    dispatch({ type: next ? "open" : "close" });
  };

  /** Lands a click made in `started`: tracked always, said only there. */
  const land = (landing: ShareLanding, started: number) => {
    if (landing.channel) track(landing.channel, tree);
    if (!live.current) return;
    const { notAttached, blocked } = landing;
    dispatch({
      type: "landed",
      session: started,
      line: { notAttached, blocked },
    });
  };

  const drawing: ShareDrawing =
    preview.status === "ready" && file
      ? { status: "ready", image: file }
      : { status: preview.status === "failed" ? "failed" : "drawing" };

  // Nothing is awaited before the click's work starts: a browser only
  // grants LinkedIn's tab inside the click. A synchronous throw (a name
  // encodeURIComponent refuses) reports like any other failure.
  const linkedIn = () => {
    const fail = (error: unknown) =>
      logAndReportError("org_chart_share", error);
    try {
      const route = shareRoute({
        tauri: isTauri(),
        native: osIsNativeMobile(),
        coarse: coarsePointer(),
        sheet: shareSheet(),
        image: file,
      });
      const started = session.current;
      const run = () =>
        (
          linkedInShare.click({
            route,
            drawing,
            post: (link) => sharePostText(t, tree, link),
            holding: t("orgChart.share.holding"),
            job: linkedInShare.job,
          }) ?? Promise.resolve(null)
        )
          .then((landing) => {
            if (landing) land(landing, started);
          })
          .catch(fail);
      if (route.kind === "sheet") void run();
      else gate(run);
    } catch (error) {
      fail(error);
    }
  };

  // The write takes the image as a promise and starts in the click's tick.
  const copyImage = () => {
    copyImageToClipboard(current().png)
      .then((copied) => {
        if (!copied) return;
        track("copy_image", tree);
        if (!live.current) return;
        dispatch({ type: "copied" });
        clearTimer();
        timer.current = setTimeout(
          () => dispatch({ type: "copiedDone" }),
          COPIED_MS,
        );
      })
      .catch((error: unknown) =>
        logAndReportError("org_chart_share_copy_image", error),
      );
  };

  const followBlocked = () => {
    if (state.line?.blocked) track(state.line.blocked.channel, tree);
  };

  return {
    open: state.open,
    setOpen,
    preview,
    retry: () => void retry(),
    line: state.line,
    followBlocked,
    linkedIn,
    preparing: drawing.status === "drawing" || linkedInShare.publishing,
    download: () =>
      void downloadShareImage(current()).then((saved) => {
        if (saved) track("download", tree);
      }),
    canCopy: canCopyImage(),
    copied: state.copied,
    copyImage,
  };
}
