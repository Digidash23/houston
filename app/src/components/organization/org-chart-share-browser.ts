import { logAndReportError } from "../../lib/error-report";
import { openExternalUrl } from "../../lib/open-external-url";
import { saveBlob } from "../../lib/save-blob";
import { copyImageWith } from "./org-chart-share-copy";
import type { ShareRunDeps } from "./org-chart-share-run";
import type { ShareImageDraw } from "./use-share-card-image";

/** The share run's deps bound to this browser (or the desktop webview). */
export function browserShareDeps(
  post: (link: string) => string,
  drawing: ShareImageDraw,
  phone: boolean,
): ShareRunDeps {
  return {
    post,
    png: drawing.png,
    ready: drawing.ready,
    phone,
    sheet: shareSheet(),
    copyImage: canCopyImage() ? writeImage : undefined,
    open: openExternalUrl,
    save: async (file) => (await saveBlob(file.name, file)).kind === "saved",
    report: logAndReportError,
  };
}

/** `navigator.share` and `canShare`, where there is a share sheet. */
export function shareSheet(): ShareRunDeps["sheet"] {
  return typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
    ? {
        canShare: (data) => navigator.canShare(data),
        share: (data) => navigator.share(data),
      }
    : undefined;
}

/** Whether this browser can put a PNG on the clipboard. */
export function canCopyImage(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof globalThis.ClipboardItem === "function"
  );
}

/** One PNG `ClipboardItem`; it takes the promise, so the write starts now. */
function writeImage(png: Promise<File>): Promise<void> {
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** The dialog's Copy image (`copyImageWith`) on this browser's clipboard. */
export function copyImageToClipboard(png: Promise<File>): Promise<boolean> {
  return copyImageWith(writeImage, logAndReportError, png);
}

/** The dialog's Download image: `true` once saved, `false` when cancelled. */
export async function downloadShareImage(
  drawing: ShareImageDraw,
): Promise<boolean> {
  try {
    const file = await drawing.png;
    return (await saveBlob(file.name, file)).kind === "saved";
  } catch (error) {
    // A failed drawing already reported; the preview offers Try again.
    if (!drawing.failed) logAndReportError("org_chart_share_save", error);
    return false;
  }
}
