import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import { analytics } from "../../lib/analytics";
import { logAndReportError } from "../../lib/error-report";
import {
  browserShareDeps,
  canCopyImage,
  copyImageToClipboard,
  downloadShareImage,
  shareSheet,
} from "./org-chart-share-browser";
import { sharePostText } from "./org-chart-share-model";
import { linkedInAction } from "./org-chart-share-publish";
import {
  type ShareOutcome,
  shareLanding,
  shareOrgChart,
  usesShareSheet,
} from "./org-chart-share-run";
import {
  INITIAL_SHARE_DIALOG,
  replacesShownImage,
  shareDialogReducer,
} from "./org-chart-share-state";
import { shareCounts, trackShare as track } from "./org-chart-share-track";
import type { OrgTree } from "./org-chart-tree";
import { createSingleFlight } from "./single-flight";
import { useShareCardImage } from "./use-share-card-image";
import { useSharePublish } from "./use-share-publish";

/** How long Copy image reads "Copied". */
const COPIED_MS = 2000;

/**
 * The share dialog's state and actions over the image drawn ahead
 * (`useShareCardImage`) and the chart's page, published in two explicit
 * steps (`org-chart-share-publish.ts`): the first click on Share on LinkedIn
 * publishes, the next one opens LinkedIn. Opening LinkedIn does all its work
 * inside the click and is single-flight (a double click would open LinkedIn
 * twice); the phone's share sheet is left ungated, since a sheet that never
 * settles would kill the button and a second tap is already quiet.
 * Unexpected failures report and show nothing.
 */
export function useOrgChartShare(tree: OrgTree, phone: boolean) {
  const { t } = useTranslation("teams");
  const { current, preview, file, retry } = useShareCardImage(tree);
  const flight = useRef(createSingleFlight());
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
  const sheet = file
    ? usesShareSheet({ phone, ready: file, sheet: shareSheet() })
    : false;
  const { publish, start: startPublish } = useSharePublish(
    tree,
    state.open,
    file,
  );

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

  /** Lands a share started in `started`: tracked always, said only there. */
  const land = (outcome: ShareOutcome, started: number) => {
    const landing = shareLanding(outcome, isTauri());
    if (landing.channel) track(landing.channel, tree);
    if (!live.current) return;
    dispatch({
      type: "landed",
      session: started,
      line: {
        line: landing.line,
        blocked: landing.blocked,
        url: outcome.kind === "linkedin" ? outcome.url : null,
      },
    });
  };

  const action = linkedInAction(preview.status, sheet, publish);

  // Nothing is awaited before the run starts: the clipboard write and the
  // open must stay inside the click. A synchronous throw (a name
  // encodeURIComponent refuses) reports like any other failure.
  const linkedIn = () => {
    if (action.kind === "preparing") return;
    if (action.kind === "publish") {
      startPublish();
      return;
    }
    const fail = (error: unknown) =>
      logAndReportError("org_chart_share", error);
    try {
      const deps = browserShareDeps(
        (link) => sharePostText(t, tree, link),
        current(),
        phone,
      );
      const started = session.current;
      const page = action.kind === "link" ? action.pageUrl : null;
      const start = () =>
        shareOrgChart(deps, page)
          .then((outcome) => land(outcome, started))
          .catch(fail);
      if (usesShareSheet(deps)) void start();
      else flight.current(start);
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
    if (state.line?.blocked) track(state.line.blocked, tree);
  };

  return {
    open: state.open,
    setOpen,
    preview,
    retry: () => void retry(),
    line: state.line,
    followBlocked,
    linkedIn,
    linkedInStep:
      action.kind === "preparing"
        ? ("preparing" as const)
        : action.kind === "link"
          ? ("open" as const)
          : ("share" as const),
    download: () =>
      void downloadShareImage(current()).then((saved) => {
        if (saved) track("download", tree);
      }),
    canCopy: canCopyImage(),
    copied: state.copied,
    copyImage,
  };
}
