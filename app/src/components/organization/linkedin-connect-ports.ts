import type { LinkedInConnectPorts } from "@houston/sdk/linkedin/connect-flow";
import type { useTranslation } from "react-i18next";
import { reserveBrowserTab } from "../../lib/browser-tab";
import { logAndReportError } from "../../lib/error-report";
import { generateState } from "../../lib/identity/pkce";
import { tauriLinkedIn } from "../../lib/linkedin-facade";
import { normalizeLocale } from "../../lib/locale";
import { openExternalUrl } from "../../lib/open-external-url";
import {
  type ChannelsLoopbackCopy,
  osCancelChannelsLoopback,
  osIsTauri,
  osStartChannelsLoopback,
} from "../../lib/os-bridge";
import { osIsNativeMobile } from "../../lib/os-bridge/platform";
import { linkedInConnectSurface } from "./linkedin-connect-surface";

type Translate = ReturnType<typeof useTranslation<"teams">>["t"];

/** The desktop's LinkedIn return pages, in the person's language. */
function returnCopy(t: Translate, language: string | undefined) {
  return {
    lang: normalizeLocale(language) ?? "en",
    success: {
      heading: t("orgChart.share.returnPage.returnHeading"),
      body: t("orgChart.share.returnPage.returnBody"),
    },
    stale: {
      heading: t("orgChart.share.returnPage.staleHeading"),
      body: t("orgChart.share.returnPage.staleBody"),
    },
    openButton: t("orgChart.share.returnPage.openHouston"),
  } satisfies ChannelsLoopbackCopy;
}

/**
 * The effects `startLinkedInConnect` runs, bound here, built INSIDE the
 * click: the web claims LinkedIn's tab now (a browser grants it only there),
 * the desktop binds its return listener and opens the system browser, the
 * mobile app asks for its deep link (`linkedInConnectSurface`).
 */
export function linkedInConnectPorts(
  t: Translate,
  language: string | undefined,
): LinkedInConnectPorts {
  const surface = linkedInConnectSurface({
    tauri: osIsTauri(),
    nativeMobile: osIsNativeMobile(),
  });
  const desktop = surface === "desktop";
  return {
    connect: tauriLinkedIn.connect,
    listener: desktop
      ? {
          start: (state) =>
            osStartChannelsLoopback(state, returnCopy(t, language), "linkedin"),
          cancel: osCancelChannelsLoopback,
        }
      : null,
    appReturn: surface === "mobileApp",
    newState: generateState,
    tab: surface === "web" ? reserveBrowserTab() : null,
    open: (url) => openExternalUrl(url, { command: "linkedin_connect" }),
    report: logAndReportError,
  };
}
