import {
  isShareBusy,
  isShareCancel,
  linkedInShareUrl,
  type ShareChannel,
} from "./org-chart-share-model.ts";

/**
 * The Share button's sequencing, with the browser handed in so the order is
 * testable. DOM-free.
 */

/**
 * A clipboard the browser refused: a write it did not allow (no focus, no
 * permission). The person's setup, not a bug: nothing to report.
 */
export function isExpectedClipboardRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotAllowedError"
  );
}

export interface ShareRunDeps {
  post: string;
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
  /** Open in the browser; `false` when it did not take the URL. */
  open: (url: string) => Promise<boolean>;
  /** Save as a download; `false` when the person cancelled the save. */
  save: (file: File) => Promise<boolean>;
  report: (command: string, error: unknown) => void;
}

/** Where the image went on the LinkedIn path. */
export type ImageHandoff = "copied" | "saved" | "none";

export type ShareOutcome =
  | { kind: "native" }
  | { kind: "cancelled" }
  | { kind: "failed" }
  | { kind: "linkedin"; url: string; opened: boolean; image: ImageHandoff };

/**
 * Share the org chart in one click. On a phone that can share files, the
 * share sheet takes the image and the post (the LinkedIn app reads both).
 * Everywhere else LinkedIn's composer opens with the post, and the image
 * goes on the clipboard, or is saved as a file when the clipboard refuses.
 */
export function shareOrgChart(deps: ShareRunDeps): Promise<ShareOutcome> {
  const { ready, sheet } = deps;
  if (deps.phone && ready && sheet?.canShare({ files: [ready] }))
    return sheet.share({ files: [ready], text: deps.post }).then(
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

/**
 * The clipboard write and the open both start in the click's own tick, with
 * no `await` before either: Safari only lets a page write the clipboard or
 * open a tab while the click is still being handled. The write starts first
 * because opening a tab takes focus from the page, and the write takes the
 * image as a promise, so a drawing still under way does not break the
 * gesture.
 */
function shareToLinkedIn(deps: ShareRunDeps): Promise<ShareOutcome> {
  const url = linkedInShareUrl(deps.post);
  let copying: Promise<boolean>;
  try {
    copying = deps.copyImage
      ? deps.copyImage(deps.png).then(
          () => true,
          (error: unknown) => refused(deps, error),
        )
      : Promise.resolve(false);
  } catch (error) {
    copying = refused(deps, error);
  }
  const opening = deps.open(url);
  return Promise.all([opening, copying]).then(async ([opened, copied]) => ({
    kind: "linkedin",
    url,
    opened,
    image: copied ? "copied" : await saveInstead(deps),
  }));
}

/**
 * A refused write reports only when it is neither the browser's own refusal
 * nor the drawing failing (which reported when it failed).
 */
async function refused(deps: ShareRunDeps, error: unknown): Promise<false> {
  const drawn = await deps.png.then(
    () => true,
    () => false,
  );
  if (drawn && !isExpectedClipboardRefusal(error))
    deps.report("org_chart_share_copy_image", error);
  return false;
}

async function saveInstead(deps: ShareRunDeps): Promise<ImageHandoff> {
  let file: File;
  try {
    file = await deps.png;
  } catch {
    // The drawing reported its own failure; LinkedIn is open without it.
    return "none";
  }
  try {
    return (await deps.save(file)) ? "saved" : "none";
  } catch (error) {
    deps.report("org_chart_share_download", error);
    return "none";
  }
}

/** What the person is told once a share lands, and what is tracked. */
export interface ShareLanding {
  /** Tracked now: the share left. `null` when it did not (yet). */
  channel: ShareChannel | null;
  /** The toast: where the image went, else that the tab was blocked. */
  toast: "copied" | "saved" | "blocked" | null;
  /**
   * The browser blocked LinkedIn's tab: the toast carries an Open LinkedIn
   * action, and opening it tracks this channel.
   */
  blocked: ShareChannel | null;
}

const QUIET: ShareLanding = { channel: null, toast: null, blocked: null };

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
  const channel: ShareChannel =
    outcome.image === "copied"
      ? "linkedin"
      : outcome.image === "saved"
        ? "linkedin_download"
        : "linkedin_text_only";
  const image = outcome.image === "none" ? null : outcome.image;
  if (outcome.opened) return { channel, toast: image, blocked: null };
  if (tauri) return { ...QUIET, toast: image };
  return { channel: null, toast: image ?? "blocked", blocked: channel };
}
