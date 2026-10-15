import { reserveBrowserTab } from "../../lib/browser-tab";
import { logAndReportError } from "../../lib/error-report";
import { openExternalUrl } from "../../lib/open-external-url";
import { osIsTauri } from "../../lib/os-bridge/platform";
import { saveBlob } from "../../lib/save-blob";
import { tauriOrg } from "../../lib/tauri";
import type { ShareRunDeps } from "./org-chart-share-run";
import type { ShareImageDraw } from "./use-share-card-image";

/**
 * The share run's deps bound to this browser (or the desktop webview).
 * `title` names the published page; `publishing` brackets the upload, for
 * the button's pending state.
 */
export function browserShareDeps(
  post: (link: string) => string,
  title: string,
  drawing: ShareImageDraw,
  phone: boolean,
  publishing: (pending: boolean) => void,
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
    publish: (png) => {
      publishing(true);
      return tauriOrg
        .publishChartShare(png, title)
        .finally(() => publishing(false));
    },
    // The desktop shell hands URLs to the OS, which has no gesture rule.
    reserveTab: () => (osIsTauri() ? null : reserveBrowserTab()),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    open: openExternalUrl,
    save: async (file) => (await saveBlob(file.name, file)).kind === "saved",
    report: logAndReportError,
  };
}
