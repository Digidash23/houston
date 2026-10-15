import { reserveBrowserTab } from "../../lib/browser-tab";
import { logAndReportError } from "../../lib/error-report";
import { openExternalUrl } from "../../lib/open-external-url";
import { osIsTauri } from "../../lib/os-bridge/platform";
import { saveBlob } from "../../lib/save-blob";
import { tauriOrg } from "../../lib/tauri";
import { copyImageWith } from "./org-chart-share-copy";
import type { ShareRunDeps } from "./org-chart-share-run";
import { shareTabReserver } from "./org-chart-share-tab";
import type { ShareImageDraw } from "./use-share-card-image";

/**
 * The share run's deps bound to this browser (or the desktop webview).
 * `title` names the published page; `publishing` brackets the upload, for
 * the button's pending state; `holding` is the line the claimed tab shows
 * while it waits for the composer.
 */
export function browserShareDeps(
  post: (link: string) => string,
  title: string,
  drawing: ShareImageDraw,
  phone: boolean,
  publishing: (pending: boolean) => void,
  holding: string,
): ShareRunDeps {
  return {
    post,
    png: drawing.png,
    ready: drawing.ready,
    phone,
    sheet:
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function"
        ? {
            canShare: (data) => navigator.canShare(data),
            share: (data) => navigator.share(data),
          }
        : undefined,
    copyImage: canCopyImage() ? writeImage : undefined,
    publish: (png, signal) => {
      publishing(true);
      return tauriOrg
        .publishChartShare(png, title, signal)
        .finally(() => publishing(false));
    },
    reserveTab: shareTabReserver(holding, {
      tauri: osIsTauri(),
      reserve: () => reserveBrowserTab(),
      report: logAndReportError,
    }),
    wait: (ms, cancel) =>
      new Promise((resolve) => {
        if (cancel.aborted) return;
        const timer = setTimeout(resolve, ms);
        cancel.addEventListener("abort", () => clearTimeout(timer), {
          once: true,
        });
      }),
    open: openExternalUrl,
    save: async (file) => (await saveBlob(file.name, file)).kind === "saved",
    report: logAndReportError,
  };
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
