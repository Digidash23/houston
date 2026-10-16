import type { ReservedTab } from "../../lib/browser-tab.ts";
import { linkedInShareUrl, SHARE_SITE_LINK } from "./org-chart-share-model.ts";
import type { SharePublishJob } from "./org-chart-share-publish-page.ts";
import {
  NO_LANDING,
  openComposer,
  type ShareLanding,
  type ShareRoute,
  shareViaSheet,
} from "./org-chart-share-run.ts";

/**
 * Share on LinkedIn in one click. DOM-free: the browser, the publish and
 * the clock's patience are handed in.
 *
 * In a browser the click claims a tab before anything else (a tab is only
 * granted inside the click), shows the holding line in it, publishes the
 * chart's page with its link card, then points the tab at LinkedIn's
 * composer with a post that links to the page, whose preview is the
 * picture. The desktop app publishes, then opens the browser. A touch
 * device with a share sheet that takes files hands it the picture and
 * publishes nothing. A drawing already published opens the composer at
 * once, inside the click, with no tab claimed first.
 *
 * A publish that fails (refused, offline, a deployment that keeps no shared
 * pictures, or past {@link SHARE_PATIENCE_MS}) still opens the composer,
 * with a post ending on gethouston.ai, and the dialog says the picture could
 * not be attached. Closing the dialog or redrawing the chart mid-publish
 * aborts the upload and closes the claimed tab.
 *
 * Nothing publishes but a click on Share on LinkedIn: the dialog opening,
 * Download image and Copy image never make the chart public.
 */

/** How long a click waits on the chart's page before posting without it. */
export const SHARE_PATIENCE_MS = 15_000;

export interface LinkedInShareDeps {
  /** `publishPage`, bound: the page's address, or null. Never rejects. */
  publish: (
    job: SharePublishJob,
    signal: AbortSignal,
  ) => Promise<string | null>;
  /** A plain open; `false` when the browser did not take the URL. */
  open: (url: string) => Promise<boolean>;
  /** `reserveBrowserTab`: claims a tab now, `null` when refused. */
  reserve: () => ReservedTab | null;
  report: (command: string, error: unknown) => void;
  /** {@link SHARE_PATIENCE_MS} unless a test says otherwise. */
  patienceMs?: number;
}

/** The drawing on screen when the click lands. */
export type ShareDrawing =
  | { status: "drawing" }
  | { status: "failed" }
  | { status: "ready"; image: File };

export interface LinkedInClick {
  route: ShareRoute;
  drawing: ShareDrawing;
  /** The post, ending on `link`. */
  post: (link: string) => string;
  /** The claimed tab's holding line: authored, translated copy. */
  holding: string;
  job: (image: File) => SharePublishJob;
}

export interface LinkedInShareState {
  /** The page published for `image`; dropped once the chart is redrawn. */
  page: { image: File; pageUrl: string } | null;
  /** The drawing a click is publishing, while it does. */
  publishing: File | null;
}

export const LINKEDIN_SHARE_IDLE: LinkedInShareState = {
  page: null,
  publishing: null,
};

interface Run {
  image: File;
  abort: AbortController;
  tab: ReservedTab | null;
}

export function createLinkedInShare(
  deps: LinkedInShareDeps,
  onChange: (state: LinkedInShareState) => void,
) {
  let state = LINKEDIN_SHARE_IDLE;
  let run: Run | null = null;
  const set = (patch: Partial<LinkedInShareState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  const stop = (why: string) => {
    if (!run) return;
    run.abort.abort(new DOMException(why, "AbortError"));
    run.tab?.discard();
    run = null;
    set({ publishing: null });
  };

  function publishThenOpen(click: LinkedInClick, image: File) {
    // Any throw from the post comes before a tab is claimed.
    const fallback = linkedInShareUrl(click.post(SHARE_SITE_LINK));
    const job = click.job(image);
    const tab = click.route.kind === "tab" ? deps.reserve() : null;
    try {
      tab?.hold(click.holding);
    } catch (error) {
      deps.report("org_chart_share_holding", error);
    }
    const mine: Run = { image, abort: new AbortController(), tab };
    run = mine;
    set({ publishing: image });
    const patience = setTimeout(
      () =>
        mine.abort.abort(
          new DOMException("org chart share page too slow", "TimeoutError"),
        ),
      deps.patienceMs ?? SHARE_PATIENCE_MS,
    );
    return deps.publish(job, mine.abort.signal).then((pageUrl) => {
      clearTimeout(patience);
      // Closed or redrawn: `stop` already closed the tab.
      if (run !== mine) return NO_LANDING;
      run = null;
      set(
        pageUrl
          ? { publishing: null, page: { image, pageUrl } }
          : { publishing: null },
      );
      try {
        const url = pageUrl ? linkedInShareUrl(click.post(pageUrl)) : fallback;
        return openComposer(click.route.kind, tab, deps.open, url, {
          channel: pageUrl ? "linkedin_link" : "linkedin_text_only",
          notAttached: !pageUrl,
        });
      } catch (error) {
        tab?.discard();
        throw error;
      }
    });
  }

  return {
    state: () => state,
    /**
     * One click on Share on LinkedIn. `null` when it is ignored: the
     * picture is still drawing, or a click is already publishing.
     */
    click(click: LinkedInClick): Promise<ShareLanding> | null {
      const { drawing, route } = click;
      if (run || drawing.status === "drawing") return null;
      if (drawing.status === "failed")
        return openComposer(
          route.kind,
          null,
          deps.open,
          linkedInShareUrl(click.post(SHARE_SITE_LINK)),
          { channel: "linkedin_text_only", notAttached: false },
        );
      const { image } = drawing;
      if (route.kind === "sheet")
        return shareViaSheet(
          route.sheet,
          image,
          click.post(SHARE_SITE_LINK),
          deps.report,
        );
      if (state.page?.image === image)
        return openComposer(
          route.kind,
          null,
          deps.open,
          linkedInShareUrl(click.post(state.page.pageUrl)),
          { channel: "linkedin_link", notAttached: false },
        );
      return publishThenOpen(click, image);
    },
    /** The drawing on screen is `image` (null while one draws). */
    follow(image: File | null) {
      if (run && run.image !== image) stop("chart redrawn");
      if (state.page && state.page.image !== image) set({ page: null });
    },
    /** The dialog closed: a publish under way is aborted, its tab closed. */
    end() {
      stop("share dialog closed");
    },
  };
}

export type LinkedInShare = ReturnType<typeof createLinkedInShare>;
