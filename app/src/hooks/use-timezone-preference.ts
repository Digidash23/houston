import { useCallback, useEffect, useState } from "react";
import { logAndReportError } from "../lib/error-report";
import { isIdentityConfigured } from "../lib/identity";
import { tauriPreferences } from "../lib/tauri";
import {
  createTimezoneSeed,
  detectTimezone,
  timezoneOwner,
} from "../lib/timezone-seed";
import { useWorkspaceStore } from "../stores/workspaces";

/** One per app session; the shell binds it to the person and space. */
const timezone = createTimezoneSeed({
  prefs: tauriPreferences,
  detect: detectTimezone,
  report: logAndReportError,
});

/**
 * App-shell level: seed the account timezone once per session for the
 * signed-in person, and again on a new person or space, so the cloud
 * scheduler has a zone for everyone, not only those who opened Routines.
 */
export function useTimezoneSeed(uid: string | null): void {
  const workspaceId = useWorkspaceStore((s) => s.current?.id ?? null);
  const owner = timezoneOwner(uid, isIdentityConfigured(), workspaceId);
  useEffect(() => {
    if (!owner) return;
    // Failures are reported inside the seed; this catch is only a backstop.
    timezone
      .forOwner(owner)
      .catch((err) => logAndReportError("timezone_seed", err));
  }, [owner]);
}

export interface TimezoneState {
  /** Persisted IANA value, or `null` while loading or unconfirmed. */
  timezone: string | null;
  /** True once we've checked the engine — false during the first roundtrip. */
  loaded: boolean;
  /** The browser-detected zone, used as a default when prompting the user. */
  detected: string;
  /** Persist a new value and broadcast to all subscribers. */
  confirm: (tz: string) => Promise<void>;
}

/**
 * Returns the user's IANA timezone. The first read auto-saves the
 * browser-detected zone when none is stored (no "timezone gate" UX); users
 * change it later from the timezone picker in the Routines editor.
 */
export function useTimezonePreference(): TimezoneState {
  const [, force] = useState(0);

  useEffect(() => {
    const unsubscribe = timezone.subscribe(() => force((n) => n + 1));
    timezone.load().catch((err) => logAndReportError("timezone_load", err));
    return unsubscribe;
  }, []);

  const confirm = useCallback((tz: string) => timezone.set(tz), []);
  const reading = timezone.current();

  return {
    timezone: reading.value,
    loaded: reading.loaded,
    detected: detectTimezone(),
    confirm,
  };
}
