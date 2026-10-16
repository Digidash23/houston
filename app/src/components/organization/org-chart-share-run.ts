import type { ReservedTab } from "../../lib/browser-tab.ts";
import {
  isShareBusy,
  isShareCancel,
  type ShareChannel,
} from "./org-chart-share-model.ts";

/**
 * Where Share on LinkedIn goes on this device, and how each way lands.
 * DOM-free: the browser is handed in.
 */

/** `navigator.share` and `canShare`, where there is a share sheet. */
export interface ShareSheet {
  canShare: (data: { files: File[] }) => boolean;
  share: (data: { files: File[]; text: string }) => Promise<void>;
}

/**
 * How one click reaches LinkedIn:
 * - `sheet`: a touch device whose share sheet takes files, phones and iPads
 *   alike. The sheet carries the picture and the post, and nothing is
 *   published: iPad Safari suspends the Houston tab once a new tab takes
 *   focus, so a publish behind a tab would never finish.
 * - `shell`: the desktop app. The OS opens the browser whenever it is asked,
 *   so the click publishes, then opens LinkedIn.
 * - `plain`: the mobile app, or a touch device with no sheet for files. No
 *   tab is claimed (the mobile app opens its browser on demand; a claimed
 *   tab would suspend this one), so the click publishes, then opens
 *   LinkedIn, and a refused open leaves the link in the dialog.
 * - `tab`: a browser with a fine pointer. A new tab is only granted inside
 *   the click, so the click claims one at once, shows the holding line in
 *   it, and points it at LinkedIn once the chart's page is up.
 */
export type ShareRoute =
  | { kind: "sheet"; sheet: ShareSheet }
  | { kind: "shell" }
  | { kind: "plain" }
  | { kind: "tab" };

/** A capability check, never platform sniffing. */
export function shareRoute(env: {
  tauri: boolean;
  /** The Capacitor app: its browser opens after an await. */
  native: boolean;
  /** `matchMedia("(pointer: coarse)")`: the primary pointer is a finger. */
  coarse: boolean;
  sheet: ShareSheet | undefined;
  /** The drawn picture, once there is one. */
  image: File | null;
}): ShareRoute {
  if (env.tauri) return { kind: "shell" };
  const { sheet, image } = env;
  if (env.coarse && sheet && image && sheet.canShare({ files: [image] }))
    return { kind: "sheet", sheet };
  if (env.coarse || env.native) return { kind: "plain" };
  return { kind: "tab" };
}

/** What the dialog does once a click lands. */
export interface ShareLanding {
  /** Tracked now: the share left. `null` when it did not (yet). */
  channel: ShareChannel | null;
  /** The picture did not go with the post: the dialog says to download it. */
  notAttached: boolean;
  /**
   * The browser blocked LinkedIn's tab: the dialog links to `url`, and
   * following the link tracks `channel`.
   */
  blocked: { url: string; channel: ShareChannel } | null;
}

export const NO_LANDING: ShareLanding = {
  channel: null,
  notAttached: false,
  blocked: null,
};

/** The picture and the post through the share sheet. Never rejects. */
export function shareViaSheet(
  sheet: ShareSheet,
  image: File,
  text: string,
  report: (command: string, error: unknown) => void,
): Promise<ShareLanding> {
  return sheet.share({ files: [image], text }).then(
    () => ({ ...NO_LANDING, channel: "native" }),
    (error: unknown) => {
      // Closing the sheet, or a second tap while it is up, is not a failure.
      if (!isShareCancel(error) && !isShareBusy(error))
        report("org_chart_share_native", error);
      return NO_LANDING;
    },
  );
}

/**
 * Point LinkedIn's composer at `url`: in the tab the click claimed when
 * there is one, else a plain open. A claimed tab the person closed while the
 * page went up is the person leaving: nothing else opens. A plain open the
 * browser blocked offers the link in the dialog; the desktop shell already
 * explained its own refusal in a toast.
 */
export async function openComposer(
  route: ShareRoute["kind"],
  tab: ReservedTab | null,
  open: (url: string) => Promise<boolean>,
  url: string,
  share: { channel: ShareChannel; notAttached: boolean },
): Promise<ShareLanding> {
  const { channel, notAttached } = share;
  if (tab)
    return (await tab.navigate(url))
      ? { channel, notAttached, blocked: null }
      : NO_LANDING;
  if (await open(url)) return { channel, notAttached, blocked: null };
  if (route === "shell") return { ...NO_LANDING, notAttached };
  return { channel: null, notAttached, blocked: { url, channel } };
}
