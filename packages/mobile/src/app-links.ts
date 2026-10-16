import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { logAndReportError } from "@houston/app/lib/error-report";
import { useUIStore } from "@houston/app/stores/ui";
import { useWorkspaceStore } from "@houston/app/stores/workspaces";
import { type AppLinkTarget, appLinkTarget } from "./app-link-target";

type Home = Extract<AppLinkTarget, { kind: "home" }>;
type LinkedIn = Extract<AppLinkTarget, { kind: "linkedin" }>;

/**
 * Hand a LinkedIn return's ticket to the app, which redeems it once signed
 * in (`useLinkedInCompletion`). The launch URL and the open event can carry
 * the same link at a cold start, so each link is handed over once per run.
 * iOS leaves the in-app browser LinkedIn ran in on top of the app; Android's
 * single-task activity already closed its Custom Tab coming forward.
 */
function handLinkedIn(target: LinkedIn): void {
  useUIStore.getState().setPendingLinkedInCompletion(target.completion);
  if (Capacitor.getPlatform() === "ios")
    void Browser.close().catch((error: unknown) =>
      logAndReportError("mobile_close_linkedin_browser", error),
    );
}

export async function installAppLinks(): Promise<void> {
  let pending: Home | null = null;
  const handed = new Set<string>();
  const home = (target: Home) => {
    if (!useWorkspaceStore.getState().current) {
      pending = target;
      return;
    }
    useUIStore.getState().openAgentsHome(null, { nav: "reset" });
  };
  const apply = (url: string) => {
    const target = appLinkTarget(url);
    if (target?.kind === "home") home(target);
    if (target?.kind !== "linkedin" || handed.has(url)) return;
    handed.add(url);
    handLinkedIn(target);
  };
  useWorkspaceStore.subscribe((state) => {
    if (state.current && pending) {
      const target = pending;
      pending = null;
      home(target);
    }
  });
  await App.addListener("appUrlOpen", ({ url }) => apply(url));
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) apply(launch.url);
  } catch (error) {
    logAndReportError("mobile_initial_app_link", error);
  }
}
