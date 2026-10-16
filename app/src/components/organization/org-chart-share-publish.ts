import {
  publishPage,
  type SharePublishDeps,
  type SharePublishJob,
} from "./org-chart-share-publish-page.ts";

export type {
  SharePublishDeps,
  SharePublishJob,
} from "./org-chart-share-publish-page.ts";

/**
 * The chart's own page, which a LinkedIn post links to, published in two
 * explicit steps. DOM-free.
 *
 * Nothing is published until the person asks: the dialog opening, Download
 * image and Copy image never make the chart public. The first click on Share
 * on LinkedIn publishes (the button reads "Preparing your post..."); once the
 * page exists the same button reads Open LinkedIn, and that click opens the
 * composer with nothing awaited before the open, so a browser that only
 * opens a tab inside the click (iPad Safari) still does. A publish that
 * fails leaves the button on Share on LinkedIn, and the next click shares
 * without a page (the image on the clipboard): a clipboard write needs a
 * click of its own, so the failure never runs it by itself.
 *
 * A publication belongs to one drawing. When the chart is redrawn (the
 * roster changed while the dialog was open) a page or a failure for the old
 * drawing is dropped and a publish of it is aborted, so LinkedIn never gets
 * the old page; the next click publishes the new drawing.
 */

export type SharePublish =
  | { status: "idle" }
  | { status: "publishing"; image: File }
  | { status: "ready"; image: File; pageUrl: string }
  | { status: "failed"; image: File };

export const SHARE_PUBLISH_IDLE: SharePublish = { status: "idle" };

/** `publish` as it stands for `image`: one about another drawing is idle. */
export function publishFor(
  publish: SharePublish,
  image: File | null,
): SharePublish {
  return publish.status !== "idle" && publish.image === image
    ? publish
    : SHARE_PUBLISH_IDLE;
}

export interface SharePublisher {
  /**
   * Publish `job.image` (the first click on Share on LinkedIn). Ignored
   * while that drawing is publishing, published or failed.
   */
  start(job: SharePublishJob): void;
  /**
   * The drawing on screen is `image` (null while one draws): a publication
   * for any other drops to idle, aborting its upload.
   */
  follow(image: File | null): void;
  /**
   * The dialog closed: an upload under way is aborted and a failure
   * forgotten (the next opening may try again). A published page stays with
   * its drawing, so reopening on the same chart publishes nothing new.
   */
  end(): void;
}

export function createSharePublisher(
  deps: SharePublishDeps,
  onChange: (state: SharePublish) => void,
): SharePublisher {
  let state: SharePublish = SHARE_PUBLISH_IDLE;
  let running: AbortController | null = null;
  const set = (next: SharePublish) => {
    state = next;
    onChange(next);
  };
  const drop = (why: string) => {
    running?.abort(new DOMException(why, "AbortError"));
    running = null;
    if (state.status !== "idle") set(SHARE_PUBLISH_IDLE);
  };
  return {
    start(job) {
      if (publishFor(state, job.image).status !== "idle") return;
      drop("superseded");
      const run = new AbortController();
      running = run;
      const { image } = job;
      set({ status: "publishing", image });
      void publishPage(deps, job, run.signal).then((pageUrl) => {
        if (run.signal.aborted) return;
        running = null;
        set(
          pageUrl
            ? { status: "ready", image, pageUrl }
            : { status: "failed", image },
        );
      });
    },
    follow(image) {
      if (state.status !== "idle" && state.image !== image)
        drop("chart redrawn");
    },
    end() {
      if (state.status !== "ready") drop("share dialog closed");
    },
  };
}

/** What Share on LinkedIn does when clicked, and how it reads. */
export type LinkedInAction =
  /** Disabled, "Preparing your post...": the image or its page is coming. */
  | { kind: "preparing" }
  /** The phone's share sheet takes the image; nothing is published. */
  | { kind: "sheet" }
  /** "Share on LinkedIn": the click publishes the chart's page. */
  | { kind: "publish" }
  /** "Open LinkedIn": the composer opens with the page's link. */
  | { kind: "link"; pageUrl: string }
  /** "Share on LinkedIn": the composer opens without a link; the image goes on the clipboard. */
  | { kind: "fallback" };

/** `publish` must already be the drawing's own (`publishFor`). */
export function linkedInAction(
  drawing: "drawing" | "failed" | "ready",
  sheet: boolean,
  publish: SharePublish,
): LinkedInAction {
  if (drawing === "failed") return { kind: "fallback" };
  if (drawing === "drawing") return { kind: "preparing" };
  if (sheet) return { kind: "sheet" };
  switch (publish.status) {
    case "idle":
      return { kind: "publish" };
    case "publishing":
      return { kind: "preparing" };
    case "ready":
      return { kind: "link", pageUrl: publish.pageUrl };
    case "failed":
      return { kind: "fallback" };
  }
}
