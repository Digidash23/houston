import { type ReservedTab, reserveBrowserTab } from "../../lib/browser-tab";
import { logAndReportError } from "../../lib/error-report";
import { openExternalUrl } from "../../lib/open-external-url";
import { osIsTauri } from "../../lib/os-bridge/platform";
import { saveBlob } from "../../lib/save-blob";
import { tauriOrg } from "../../lib/tauri";
import { isExpectedClipboardRefusal } from "./org-chart-share-linkedin";
import type { ShareRunDeps } from "./org-chart-share-run";
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
    // The desktop shell hands URLs to the OS, which has no gesture rule.
    reserveTab: () => (osIsTauri() ? null : holdingTab(holding)),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    open: openExternalUrl,
    save: async (file) => (await saveBlob(file.name, file)).kind === "saved",
    report: logAndReportError,
  };
}

/**
 * A tab claimed for the composer, showing `line` while the upload runs. A
 * holding line that cannot be written is reported and the share goes on.
 */
function holdingTab(line: string): ReservedTab | null {
  const tab = reserveBrowserTab();
  try {
    tab?.hold(line);
  } catch (error) {
    logAndReportError("org_chart_share_holding", error);
  }
  return tab;
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

/**
 * The dialog's Copy image: `true` once the PNG is on the clipboard. A refused
 * write reports unless the drawing failed (it reported itself) or the browser
 * refused it (the person's setup, not a bug).
 */
export function copyImageToClipboard(png: Promise<File>): Promise<boolean> {
  return writeImage(png).then(
    () => true,
    async (error: unknown) => {
      const drawn = await png.then(
        () => true,
        () => false,
      );
      if (drawn && !isExpectedClipboardRefusal(error))
        logAndReportError("org_chart_share_copy_image", error);
      return false;
    },
  );
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
