import type { OrgChartShareResult } from "@houston/engine-adapter";
import type { ReservedTab } from "../../lib/browser-tab.ts";
import { shareToLinkedIn } from "./org-chart-share-linkedin.ts";
import {
  isShareBusy,
  isShareCancel,
  SHARE_SITE_LINK,
  type ShareChannel,
} from "./org-chart-share-model.ts";

/**
 * The Share button's sequencing, with the browser handed in so the order is
 * testable. DOM-free.
 */

export interface ShareRunDeps {
  /** The post, ending on `link`. */
  post: (link: string) => string;
  /** The share image, still drawing or drawn. Rejects when the draw failed. */
  png: Promise<File>;
  /** The same image when it is already drawn, for the share sheet. */
  ready: File | null;
  /** A phone-width screen, where the share sheet is the way out. */
  phone: boolean;
  /** `navigator.share` and `canShare`, absent where there is no share sheet. */
  sheet:
    | {
        canShare: (data: { files: File[] }) => boolean;
        share: (data: { files: File[]; text: string }) => Promise<void>;
      }
    | undefined;
  /**
   * `navigator.clipboard.write` of one PNG `ClipboardItem`, absent where the
   * browser has no image clipboard. It takes the promise, not the blob.
   */
  copyImage: ((png: Promise<File>) => Promise<void>) | undefined;
  /**
   * Publish the image as a page of its own, for the post to link to. `signal`
   * aborts the upload once the share stops waiting for it.
   */
  publish: (png: File, signal: AbortSignal) => Promise<OrgChartShareResult>;
  /**
   * An empty tab claimed in the click, to point at the composer once the post
   * is known; `null` where none could be or need be claimed. Discarded when
   * the run fails before pointing it anywhere.
   */
  reserveTab: () => ReservedTab | null;
  wait: (ms: number) => Promise<void>;
  /** Open in the browser; `false` when it did not take the URL. */
  open: (url: string) => Promise<boolean>;
  /** Save as a download; `false` when the person cancelled the save. */
  save: (file: File) => Promise<boolean>;
  report: (command: string, error: unknown) => void;
}

/**
 * Where the image went on the LinkedIn path: the preview of the page the post
 * links to, the clipboard, a saved file, or nowhere.
 */
export type ImageHandoff = "linked" | "copied" | "saved" | "none";

export type ShareOutcome =
  | { kind: "native" }
  | { kind: "cancelled" }
  | { kind: "failed" }
  | { kind: "linkedin"; url: string; opened: boolean; image: ImageHandoff };

/**
 * Share the org chart in one click. On a phone that can share files, the
 * share sheet takes the image and the post (the LinkedIn app reads both).
 * Everywhere else LinkedIn's composer opens with a post that links to the
 * image (`org-chart-share-linkedin.ts`).
 */
export function shareOrgChart(deps: ShareRunDeps): Promise<ShareOutcome> {
  const { ready, sheet } = deps;
  if (ready && sheet && usesShareSheet(deps))
    return sheet
      .share({ files: [ready], text: deps.post(SHARE_SITE_LINK) })
      .then(
        (): ShareOutcome => ({ kind: "native" }),
        (error: unknown): ShareOutcome => {
          if (isShareCancel(error) || isShareBusy(error))
            return { kind: "cancelled" };
          deps.report("org_chart_share_native", error);
          return { kind: "failed" };
        },
      );
  return shareToLinkedIn(deps);
}

/** Whether this share goes through the phone's share sheet. */
export function usesShareSheet(
  deps: Pick<ShareRunDeps, "phone" | "ready" | "sheet">,
): boolean {
  const { ready, sheet } = deps;
  return Boolean(deps.phone && ready && sheet?.canShare({ files: [ready] }));
}

/** What the dialog says once a share lands, and what is tracked. */
export interface ShareLanding {
  /** Tracked now: the share left. `null` when it did not (yet). */
  channel: ShareChannel | null;
  /** The line under the buttons: where the image went, else a blocked tab. */
  line: "copied" | "saved" | "blocked" | null;
  /**
   * The browser blocked LinkedIn's tab: the line carries a link to it, and
   * following the link tracks this channel.
   */
  blocked: ShareChannel | null;
}

const LINKEDIN_CHANNELS: Record<ImageHandoff, ShareChannel> = {
  linked: "linkedin_link",
  copied: "linkedin",
  saved: "linkedin_download",
  none: "linkedin_text_only",
};

const QUIET: ShareLanding = { channel: null, line: null, blocked: null };

/**
 * `tauri`: the desktop shell has no popup blocker, so a refusal there
 * already explained itself in its own toast.
 */
export function shareLanding(
  outcome: ShareOutcome,
  tauri: boolean,
): ShareLanding {
  if (outcome.kind === "native") return { ...QUIET, channel: "native" };
  if (outcome.kind !== "linkedin") return QUIET;
  const channel = LINKEDIN_CHANNELS[outcome.image];
  const image =
    outcome.image === "copied" || outcome.image === "saved"
      ? outcome.image
      : null;
  if (outcome.opened) return { channel, line: image, blocked: null };
  if (tauri) return { ...QUIET, line: image };
  return { channel: null, line: image ?? "blocked", blocked: channel };
}
