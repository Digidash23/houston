import type { Capabilities } from "@houston/engine-adapter";
import { useEffect, useRef } from "react";
import { reportError } from "../lib/error-report";
import { listenDeepLink } from "../lib/identity/deep-link-listen";
import { osCurrentDeepLinks } from "../lib/os-bridge";
import {
  applySettingsLanding,
  captureSettingsLanding,
  type SettingsLanding,
  settingsLandingFromDeepLink,
} from "../lib/settings-landing";
import {
  type SettingsSectionId,
  settingsLandingSection,
  settingsSectionFromDeepLink,
  settingsSectionFromPath,
} from "../lib/settings-sections";
import { useUIStore } from "../stores/ui";
import { useWorkspaceStore } from "../stores/workspaces";
import { useCapabilities } from "./use-capabilities";
import { useSession } from "./use-session";

/** Open a linked section, or the index where this deployment does not serve it. */
function land(
  section: SettingsSectionId,
  capabilities: Capabilities | null,
): void {
  useUIStore
    .getState()
    .openSettings(settingsLandingSection(section, capabilities));
}

function applyLanding(
  landing: SettingsLanding,
  capabilities: Capabilities | null,
): void {
  applySettingsLanding(landing, {
    open: (section) => land(section, capabilities),
    hand: (completion) =>
      useUIStore.getState().setPendingSlackCompletion(completion),
  });
}

/**
 * Apply a public link once the app can act on it. The ticket is captured and
 * stripped from the URL on mount, before the wait for sign-in and workspace
 * loading — it lives in memory from then on, never in the address bar. A
 * section also waits for the deployment's capabilities, so a Billing link where
 * the plan is not served lands on the Settings index, never a blank screen.
 */
export function useSettingsLanding() {
  const pending = useRef<SettingsLanding>({ kind: "absent" });
  const pendingPath = useRef<SettingsSectionId | null>(null);
  const ready = useRef(false);
  const captured = useRef(false);
  const { data: session } = useSession();
  const space = useWorkspaceStore((s) => s.current);
  const { capabilities, isLoading: capabilitiesLoading } = useCapabilities();
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  ready.current = Boolean(session && space) && !capabilitiesLoading;
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    // The nav stack owns navigation; this rewrites only the query of the entry
    // already on screen, passing its state through, so the stack's index
    // survives and no entry is pushed or dropped.
    pending.current = captureSettingsLanding(window.location.href, (url) =>
      window.history.replaceState(window.history.state, "", url),
    );
    pendingPath.current = settingsSectionFromPath(window.location.pathname);
    void osCurrentDeepLinks()
      .then((links) => {
        for (const link of links) {
          const section = settingsSectionFromDeepLink(link);
          if (section) pendingPath.current = section;
          const landing = settingsLandingFromDeepLink(link);
          if (landing.kind === "settings") pending.current = landing;
        }
        if (!ready.current) return;
        if (pendingPath.current) {
          land(pendingPath.current, capabilitiesRef.current);
          pendingPath.current = null;
        }
        const landing = pending.current;
        pending.current = { kind: "absent" };
        applyLanding(landing, capabilitiesRef.current);
      })
      .catch((error: unknown) =>
        reportError(
          "settings_initial_link",
          "Could not read initial settings link",
          error,
        ),
      );
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenDeepLink((value) => {
      const section = settingsSectionFromDeepLink(value);
      if (section) {
        if (ready.current) land(section, capabilitiesRef.current);
        else pendingPath.current = section;
      }
      const landing = settingsLandingFromDeepLink(value);
      if (landing.kind === "absent") return;
      if (ready.current) applyLanding(landing, capabilitiesRef.current);
      else pending.current = landing;
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) =>
        reportError(
          "settings_deep_link",
          "Could not listen for settings link",
          error,
        ),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!session || !space || capabilitiesLoading) return;
    if (pendingPath.current) {
      land(pendingPath.current, capabilitiesRef.current);
      pendingPath.current = null;
    }
    const landing = pending.current;
    pending.current = { kind: "absent" };
    applyLanding(landing, capabilitiesRef.current);
  }, [session, space, capabilitiesLoading]);
}
