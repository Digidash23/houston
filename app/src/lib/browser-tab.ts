/**
 * A browser tab claimed INSIDE a user gesture, to be pointed at a URL that is
 * only known after an async hop.
 *
 * Safari, Firefox, and Chrome under its strict popup setting honor
 * `window.open` only while the click's user activation is live: an open issued
 * after an `await` (the OAuth link the host has to mint first) is refused
 * silently, and the row claims a tab the user never saw. Opening an EMPTY tab
 * synchronously in the click and navigating it once the link arrives keeps
 * the open inside the gesture.
 *
 * Native mobile defers opening the in-app browser until navigation; only a
 * browser tab needs a synchronous empty-tab reservation.
 */
import { osIsNativeMobile } from "./os-bridge/platform";

export interface ReservedTab {
  /**
   * Point the tab at `url`. `false` when the user already closed the empty tab
   * while the link was minting, so the caller must fall back to a plain open.
   */
  navigate: (url: string) => boolean | Promise<boolean>;
  /** Close the tab if it never received a URL (the link never came). */
  discard: () => void;
  /**
   * Show `line` (authored, translated copy) in the still-empty tab, as its
   * title and a centered sentence, for a wait the person can see. Callers that
   * navigate straight away (the OAuth links) skip it and keep a blank tab.
   */
  hold: (line: string) => void;
}

/** The slice of the empty tab's `document` {@link ReservedTab.hold} writes. */
export interface HoldingDocument {
  title: string;
  body: { textContent: string | null; style: { cssText: string } } | null;
}

/** The slice of a `WindowProxy` a reservation touches; injectable for tests. */
export interface TabHandle {
  closed: boolean;
  opener: unknown;
  location: { href: string };
  close: () => void;
  /** Same-origin while the tab is still `about:blank`. */
  document?: HoldingDocument;
}

/**
 * The holding line's look: system colors and font only, so it follows the
 * person's light or dark setting with no value of its own to keep in sync.
 */
const HOLDING_STYLE =
  "margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center;font:16px/1.5 system-ui,sans-serif;color-scheme:light dark;background:Canvas;color:GrayText";

/** Opens an empty tab. `null` means the browser refused (popup blocker). */
export type TabOpener = () => TabHandle | null;

const openEmptyTab: TabOpener = () =>
  typeof window === "undefined" ? null : window.open("", "_blank");

/**
 * Claim a tab now. Returns `null` when the browser refused even the
 * synchronous open (a strict blocker, or a call made outside any gesture);
 * the caller then opens normally and reads that open's own verdict.
 */
export function reserveBrowserTab(
  open: TabOpener = openEmptyTab,
): ReservedTab | null {
  if (osIsNativeMobile()) {
    return {
      // Native Browser.open is allowed after the async link-minting hop, so
      // reserving an empty web tab would only strand a blank WebView.
      navigate: async (url) => {
        const { tauriSystem } = await import("./tauri");
        return tauriSystem.openUrl(url);
      },
      discard: () => {},
      // No tab is open yet: the in-app browser opens on navigate.
      hold: () => {},
    };
  }
  const tab = open();
  if (tab === null) return null;
  // Sever the opener link BEFORE any page loads in the tab — the same
  // tabnabbing protection `noopener` gives a direct open, which cannot be
  // used here because `noopener` makes `window.open` return null.
  tab.opener = null;
  let navigated = false;
  return {
    navigate: (url) => {
      if (tab.closed) return false;
      tab.location.href = url;
      navigated = true;
      return true;
    },
    discard: () => {
      if (!navigated && !tab.closed) tab.close();
    },
    hold: (line) => {
      const doc = tab.document;
      if (navigated || tab.closed || !doc?.body) return;
      doc.title = line;
      doc.body.style.cssText = HOLDING_STYLE;
      doc.body.textContent = line;
    },
  };
}
