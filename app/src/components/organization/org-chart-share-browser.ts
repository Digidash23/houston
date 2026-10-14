import { logAndReportError } from "../../lib/error-report";
import { openExternalUrl } from "../../lib/open-external-url";
import { saveBlob } from "../../lib/save-blob";
import type { ShareRunDeps } from "./org-chart-share-run";
import type { ShareImageDraw } from "./use-share-card-image";

/** The share run's deps bound to this browser (or the desktop webview). */
export function browserShareDeps(
  post: string,
  drawing: ShareImageDraw,
  phone: boolean,
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
    copyImage:
      typeof navigator.clipboard?.write === "function" &&
      typeof globalThis.ClipboardItem === "function"
        ? (png) =>
            navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
        : undefined,
    open: openExternalUrl,
    save: async (file) => (await saveBlob(file.name, file)).kind === "saved",
    report: logAndReportError,
  };
}
