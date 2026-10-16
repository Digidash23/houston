import { linkedInShareUrl, SHARE_SITE_LINK } from "./org-chart-share-model.ts";
import type {
  ImageHandoff,
  ShareOutcome,
  ShareRunDeps,
} from "./org-chart-share-run.ts";

/**
 * Share on LinkedIn, away from the phone's share sheet. DOM-free.
 *
 * With the chart's own page (published when the dialog opened) the post links
 * to it, and LinkedIn's composer shows the picture as the link's preview: the
 * composer opens and nothing else happens. Without one (publishing refused,
 * failed, or not served here) the post ends on gethouston.ai and the image
 * goes on the clipboard, or is saved as a file when the clipboard refuses.
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

/**
 * The clipboard write and the open both start in the click's own tick, with
 * no `await` before either: Safari only lets a page write the clipboard or
 * open a tab while the click is still being handled. The write starts first
 * because opening a tab takes focus from the page, and it takes the image as
 * a promise, so a drawing still under way does not break the gesture.
 */
export function shareToLinkedIn(
  deps: ShareRunDeps,
  page: string | null,
): Promise<ShareOutcome> {
  if (page) {
    const url = linkedInShareUrl(deps.post(page));
    return deps
      .open(url)
      .then((opened) => ({ kind: "linkedin", url, opened, image: "linked" }));
  }
  const url = linkedInShareUrl(deps.post(SHARE_SITE_LINK));
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
