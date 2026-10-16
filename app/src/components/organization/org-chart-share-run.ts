import {
  isShareBusy,
  isShareCancel,
  type ShareChannel,
} from "./org-chart-share-model.ts";

/**
 * Where Share on LinkedIn goes on this device. DOM-free: the browser is
 * handed in.
 */

/** `navigator.share` and `canShare`, where there is a share sheet. */
export interface ShareSheet {
  canShare: (data: { files: File[] }) => boolean;
  share: (data: { files: File[]; text: string }) => Promise<void>;
}

/**
 * How the dialog reaches LinkedIn:
 * - `sheet`: a touch device whose share sheet takes files, phones and iPads
 *   alike. The sheet carries the picture and the post; the LinkedIn app
 *   reads both.
 * - `post`: the deployment can post for the person (`linkedinShare`):
 *   Houston posts the picture itself, once their LinkedIn is connected.
 * - `paste`: everywhere else. LinkedIn's composer opens with the post, and
 *   the picture goes on the clipboard to paste, or is saved to add.
 */
export type ShareRoute =
  | { kind: "sheet"; sheet: ShareSheet }
  | { kind: "post" }
  | { kind: "paste" };

/** A capability check, never platform sniffing. */
export function shareRoute(env: {
  tauri: boolean;
  /** `matchMedia("(pointer: coarse)")`: the primary pointer is a finger. */
  coarse: boolean;
  sheet: ShareSheet | undefined;
  /** The drawn picture, once there is one; until then a sheet is assumed. */
  image: File | null;
  /** The deployment advertises `linkedinShare`. */
  linkedin: boolean;
}): ShareRoute {
  const { sheet, image } = env;
  if (
    !env.tauri &&
    env.coarse &&
    sheet &&
    (!image || sheet.canShare({ files: [image] }))
  )
    return { kind: "sheet", sheet };
  return env.linkedin ? { kind: "post" } : { kind: "paste" };
}

/**
 * The line under the dialog's buttons:
 * - `copied` / `saved`: where the picture went on the paste route.
 * - `blocked`: the browser kept LinkedIn (its composer, or its connect page)
 *   from opening; the line links to `url`, and following it tracks `channel`.
 *   `image` says where the picture went first, on the paste route.
 * - `reconnect`: LinkedIn no longer honors the connection.
 * - `wait`: too many posts for now; `retryAfterMs` when the gateway said how
 *   long.
 * - `retry`: LinkedIn failed the post.
 * - `posted`: the post is up.
 */
export type ShareLine =
  | { kind: "copied" }
  | { kind: "saved" }
  | {
      kind: "blocked";
      url: string;
      channel: ShareChannel | null;
      image?: "copied" | "saved";
    }
  | { kind: "reconnect" }
  | { kind: "wait"; retryAfterMs?: number }
  | { kind: "retry" }
  | { kind: "posted" };

/** What the dialog does once a share lands. */
export interface ShareLanding {
  /** Tracked now: the share left. `null` when it did not (yet). */
  channel: ShareChannel | null;
  line: ShareLine | null;
}

export const NO_LANDING: ShareLanding = { channel: null, line: null };

/** The picture and the post through the share sheet. Never rejects. */
export function shareViaSheet(
  sheet: ShareSheet,
  image: File,
  text: string,
  report: (command: string, error: unknown) => void,
): Promise<ShareLanding> {
  return sheet.share({ files: [image], text }).then(
    () => ({ channel: "native", line: null }),
    (error: unknown) => {
      // Closing the sheet, or a second tap while it is up, is not a failure.
      if (!isShareCancel(error) && !isShareBusy(error))
        report("org_chart_share_native", error);
      return NO_LANDING;
    },
  );
}
