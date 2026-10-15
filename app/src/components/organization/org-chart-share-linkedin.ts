import { isExpectedOrgChartShareRefusal } from "@houston/wire-types";
import type { ReservedTab } from "../../lib/browser-tab.ts";
import { linkedInShareUrl, SHARE_SITE_LINK } from "./org-chart-share-model.ts";
import type {
  ImageHandoff,
  ShareOutcome,
  ShareRunDeps,
} from "./org-chart-share-run.ts";

/**
 * Share on LinkedIn, away from the phone's share sheet. DOM-free.
 *
 * The image is published as a page of its own and the post links to it, so
 * LinkedIn's composer shows the image as the link's preview. Where publishing
 * is refused or fails, the post ends on gethouston.ai and the image goes on
 * the clipboard (or is saved as a file), as it did before pages existed.
 */

/** How long the composer waits on the upload before going without the link. */
export const PUBLISH_PATIENCE_MS = 12_000;

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
 * The clipboard write and the tab both start in the click's own tick, before
 * any `await`: Safari only lets a page write the clipboard or open a tab while
 * the click is still being handled. The write starts first because opening a
 * tab takes focus from the page. It takes the image as a promise that settles
 * only once the upload has: the image when the post goes without a link, a
 * rejection (which writes nothing) when the link carries it. The tab opens
 * empty and is pointed at the composer once the post is known; where no tab
 * could be claimed (the desktop shell, whose open has no gesture rule), the
 * composer opens then.
 */
export function shareToLinkedIn(deps: ShareRunDeps): Promise<ShareOutcome> {
  const link = publishedLink(deps);
  const forClipboard = link.then((page) =>
    page ? Promise.reject(new Error("the post links the image")) : deps.png,
  );
  // The write may never read this promise (no clipboard, a throw).
  forClipboard.catch(() => {});
  let copying: Promise<boolean>;
  try {
    copying = deps.copyImage
      ? deps.copyImage(forClipboard).then(
          () => true,
          (error: unknown) => refused(deps, link, error),
        )
      : Promise.resolve(false);
  } catch (error) {
    copying = refused(deps, link, error);
  }
  const tab = deps.reserveTab();
  return link.then(async (page) => {
    const url = linkedInShareUrl(deps.post(page ?? SHARE_SITE_LINK));
    const opened = await openComposer(deps, tab, url);
    const image: ImageHandoff = page
      ? "linked"
      : (await copying)
        ? "copied"
        : await saveInstead(deps);
    return { kind: "linkedin", url, opened, image };
  });
}

/**
 * The chart's page, or null to go without it: the drawing failed (it
 * reported itself), the upload was refused or failed, or it outlasted
 * {@link PUBLISH_PATIENCE_MS}. Never rejects. Only a refusal nothing outside
 * Houston explains, or a failure, is reported.
 */
async function publishedLink(deps: ShareRunDeps): Promise<string | null> {
  let file: File;
  try {
    file = await deps.png;
  } catch {
    return null;
  }
  const publishing = deps.publish(file).then(
    (result) => {
      if (result.kind === "published") return result.pageUrl;
      if (!isExpectedOrgChartShareRefusal(result.code))
        deps.report(
          "org_chart_share_publish",
          new Error(`org chart share refused: ${result.code}`),
        );
      return null;
    },
    (error: unknown) => {
      deps.report("org_chart_share_publish", error);
      return null;
    },
  );
  return Promise.race([
    publishing,
    deps.wait(PUBLISH_PATIENCE_MS).then(() => null),
  ]);
}

async function openComposer(
  deps: ShareRunDeps,
  tab: ReservedTab | null,
  url: string,
): Promise<boolean> {
  if (tab && (await tab.navigate(url))) return true;
  return deps.open(url);
}

/**
 * A refused write reports only when the post went without the link (else the
 * refusal was asked for), the drawing did not fail (it reported itself), and
 * it is not the browser's own refusal.
 */
async function refused(
  deps: ShareRunDeps,
  link: Promise<string | null>,
  error: unknown,
): Promise<false> {
  if (await link) return false;
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
