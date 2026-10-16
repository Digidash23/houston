import type {
  OrgChartShareInput,
  OrgChartShareResult,
} from "@houston/engine-adapter";
import { isExpectedOrgChartShareRefusal } from "@houston/wire-types";

/**
 * The chart's own page, published while the share dialog is open, so Share
 * on LinkedIn has its link the moment it is clicked. DOM-free.
 *
 * Publishing starts when the dialog opens (once the image is drawn) rather
 * than in the click: a browser that suspends the page once LinkedIn's tab
 * takes focus (iPad Safari) would never finish an upload started there, and
 * LinkedIn keeps a post's preview from the moment it is posted, so the page
 * and its card must already exist. One publish per opening; closing the
 * dialog aborts one under way. A page published for the same drawing is
 * kept, so reopening the dialog on an unchanged chart publishes nothing new.
 */

export type SharePublish =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "ready"; pageUrl: string }
  | { status: "failed" };

export const SHARE_PUBLISH_IDLE: SharePublish = { status: "idle" };

export interface SharePublishDeps {
  /** `sdk.org.publishOrgChartShare`, bound. */
  publish: (input: OrgChartShareInput) => Promise<OrgChartShareResult>;
  report: (command: string, error: unknown) => void;
}

/** One opening's publish. */
export interface SharePublishJob {
  image: File;
  title: string;
  /** Draws the 1200 x 630 link card around `image`. */
  card: (image: File) => Promise<Blob>;
  deployment: OrgChartShareInput["deployment"];
}

export interface SharePublisher {
  /** Publish for dialog session `session`; ignored once it has begun. */
  begin(session: number, job: SharePublishJob): void;
  /** The dialog closed: abort an upload under way, forget the session. */
  end(): void;
}

export function createSharePublisher(
  deps: SharePublishDeps,
  onChange: (state: SharePublish) => void,
): SharePublisher {
  let state: SharePublish = SHARE_PUBLISH_IDLE;
  let session: number | null = null;
  let running: AbortController | null = null;
  let kept: { image: File; pageUrl: string } | null = null;
  const set = (next: SharePublish) => {
    state = next;
    onChange(next);
  };
  return {
    begin(next, job) {
      if (session === next) return;
      running?.abort(new DOMException("superseded", "AbortError"));
      session = next;
      if (kept?.image === job.image) {
        running = null;
        set({ status: "ready", pageUrl: kept.pageUrl });
        return;
      }
      const run = new AbortController();
      running = run;
      set({ status: "publishing" });
      void publishPage(deps, job, run.signal).then((pageUrl) => {
        if (run.signal.aborted) return;
        running = null;
        if (pageUrl) kept = { image: job.image, pageUrl };
        set(pageUrl ? { status: "ready", pageUrl } : { status: "failed" });
      });
    },
    end() {
      running?.abort(new DOMException("share dialog closed", "AbortError"));
      running = null;
      session = null;
      if (state.status !== "idle") set(SHARE_PUBLISH_IDLE);
    },
  };
}

/**
 * The page's address, or null to share without it. Never rejects. A card
 * that cannot be drawn is reported and the chart goes up without it (the
 * page then previews the square chart). Only a refusal nothing outside
 * Houston explains, or a failure, is reported; an aborted publish is not.
 */
async function publishPage(
  deps: SharePublishDeps,
  job: SharePublishJob,
  signal: AbortSignal,
): Promise<string | null> {
  let preview: Blob | undefined;
  try {
    preview = await job.card(job.image);
  } catch (error) {
    deps.report("org_chart_share_card", error);
  }
  if (signal.aborted) return null;
  try {
    const result = await deps.publish({
      image: job.image,
      preview,
      title: job.title,
      deployment: job.deployment,
      signal,
    });
    if (result.kind === "published") return result.pageUrl;
    if (!isExpectedOrgChartShareRefusal(result.code))
      deps.report(
        "org_chart_share_publish",
        new Error(`org chart share refused: ${result.code}`),
      );
  } catch (error) {
    if (!signal.aborted) deps.report("org_chart_share_publish", error);
  }
  return null;
}

/** What Share on LinkedIn does when clicked, and how it reads. */
export type LinkedInAction =
  /** Disabled, "Preparing your post...": the image or its page is coming. */
  | { kind: "preparing" }
  /** The phone's share sheet takes the image. */
  | { kind: "sheet" }
  /** The composer opens with the page's link. */
  | { kind: "link"; pageUrl: string }
  /** The composer opens without a link; the image goes on the clipboard. */
  | { kind: "fallback" };

export function linkedInAction(
  drawing: "drawing" | "failed" | "ready",
  sheet: boolean,
  publish: SharePublish,
): LinkedInAction {
  if (drawing === "failed") return { kind: "fallback" };
  if (drawing === "drawing") return { kind: "preparing" };
  if (sheet) return { kind: "sheet" };
  if (publish.status === "ready")
    return { kind: "link", pageUrl: publish.pageUrl };
  if (publish.status === "failed") return { kind: "fallback" };
  return { kind: "preparing" };
}
