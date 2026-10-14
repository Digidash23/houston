import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { analytics } from "../../lib/analytics";
import { logAndReportError } from "../../lib/error-report";
import { saveBlob } from "../../lib/save-blob";
import { browserShareDeps } from "./org-chart-share-browser";
import { type ShareChannel, sharePostText } from "./org-chart-share-model";
import {
  isExpectedClipboardRefusal,
  type ShareLanding,
  type ShareOutcome,
  type ShareRunDeps,
  shareLanding,
  shareOrgChart,
  usesShareSheet,
} from "./org-chart-share-run";
import type { OrgTree } from "./org-chart-tree";
import { createSingleFlight } from "./single-flight";
import { useShareCardImage } from "./use-share-card-image";

/** How long Copy image reads "Copied". */
const COPIED_MS = 2000;

/** Counts only: no names ride a share event. */
function counts(tree: OrgTree) {
  return { agent_count: tree.counts.agents, people_count: tree.counts.people };
}
function track(channel: ShareChannel, tree: OrgTree) {
  analytics.track("org_chart_shared", {
    share_channel: channel,
    ...counts(tree),
  });
}

/** The line under the dialog's buttons, with LinkedIn's link when blocked. */
export type ShareLine = Pick<ShareLanding, "line" | "blocked"> & {
  url: string | null;
};

/**
 * The share dialog's state and actions over the image drawn ahead
 * (`useShareCardImage`). Share on LinkedIn keeps the clipboard write and
 * the open inside the click and is single-flight (a double click would
 * open LinkedIn twice); the phone's share sheet is left ungated, since a
 * sheet that never settles would kill the button and a second tap is
 * already quiet. Unexpected failures report and show nothing.
 */
export function useOrgChartShare(tree: OrgTree, phone: boolean) {
  const { t } = useTranslation("teams");
  const { current, preview, retry } = useShareCardImage(tree);
  const flight = useRef(createSingleFlight());
  const [open, setOpenState] = useState(false);
  const [line, setLine] = useState<ShareLine | null>(null);
  const [copied, setCopied] = useState(false);
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const setOpen = (next: boolean) => {
    if (next) {
      analytics.track("org_chart_share_opened", counts(tree));
      setLine(null);
    }
    setOpenState(next);
  };

  const land = (outcome: ShareOutcome) => {
    const landing = shareLanding(outcome, isTauri());
    if (landing.channel) track(landing.channel, tree);
    if (!live.current) return;
    setLine({
      line: landing.line,
      blocked: landing.blocked,
      url: outcome.kind === "linkedin" ? outcome.url : null,
    });
  };

  // Nothing is awaited before the run starts: the clipboard write and the
  // open must stay inside the click. A synchronous throw (a name
  // encodeURIComponent refuses) reports like any other failure.
  const run = (deps: ShareRunDeps): Promise<void> => {
    const fail = (error: unknown) =>
      logAndReportError("org_chart_share", error);
    try {
      return shareOrgChart(deps).then(land).catch(fail);
    } catch (error) {
      fail(error);
      return Promise.resolve();
    }
  };

  const linkedIn = () => {
    try {
      const deps = browserShareDeps(sharePostText(t, tree), current(), phone);
      if (usesShareSheet(deps)) void run(deps);
      else flight.current(() => run(deps));
    } catch (error) {
      logAndReportError("org_chart_share", error);
    }
  };

  const download = async () => {
    try {
      const file = await current().png;
      const saved = await saveBlob(file.name, file);
      if (saved.kind === "saved") track("download", tree);
    } catch (error) {
      // A failed drawing already reported; the preview offers Try again.
      if (!current().failed) logAndReportError("org_chart_share_save", error);
    }
  };

  const canCopy =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof globalThis.ClipboardItem === "function";

  // The write takes the image as a promise and starts in the click's tick.
  const copyImage = () => {
    const { png } = current();
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": png })])
      .then(() => {
        track("copy_image", tree);
        if (!live.current) return;
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(async (error: unknown) => {
        const drawn = await png.then(
          () => true,
          () => false,
        );
        if (drawn && !isExpectedClipboardRefusal(error))
          logAndReportError("org_chart_share_copy_image", error);
      });
  };

  const followBlocked = () => {
    if (line?.blocked) track(line.blocked, tree);
  };

  return {
    open,
    setOpen,
    preview,
    retry: () => void retry(),
    line,
    followBlocked,
    linkedIn,
    download: () => void download(),
    canCopy,
    copied,
    copyImage,
  };
}
