import { TIMEZONE_PREFERENCE } from "@houston/sdk";
import { useCallback, useEffect, useState } from "react";
import { logAndReportError } from "../lib/error-report";
import {
  isIdentityConfigured,
  SESSION_QUERY_KEY,
  type Session,
} from "../lib/identity";
import { queryClient } from "../lib/query-client";
import { tauriPreferences } from "../lib/tauri";
import { detectTimezone, timezoneOwner } from "../lib/timezone-seed";
import { useWorkspaceStore } from "../stores/workspaces";

/** The workspace to seed in and the person-and-space key that re-runs it. */
function useSeedTarget(): { workspaceId: string; owner: string } | null {
  const workspaceId = useWorkspaceStore((s) => s.current?.id ?? null);
  const uid =
    queryClient.getQueryData<Session | null>(SESSION_QUERY_KEY)?.uid ?? null;
  const owner = timezoneOwner(uid, isIdentityConfigured(), workspaceId);
  return owner && workspaceId ? { workspaceId, owner } : null;
}

/**
 * Seed through the SDK (create-only, so a stored zone always wins); never
 * rejects. The zone to render: the account's, or the detected one when the
 * seed failed (already reported).
 */
async function seedIn(workspaceId: string): Promise<string> {
  try {
    return (await tauriPreferences.seedTimezone(workspaceId, detectTimezone()))
      .timezone;
  } catch (err) {
    logAndReportError("timezone_seed", err);
    return detectTimezone();
  }
}

/**
 * App-shell level: seed the account timezone for the signed-in person in the
 * current space, so the cloud scheduler (routines, the morning briefing) has
 * a zone for everyone, not only those who opened Routines.
 */
export function useTimezoneSeed(): void {
  const target = useSeedTarget();
  const owner = target?.owner;
  const workspaceId = target?.workspaceId;
  useEffect(() => {
    if (owner && workspaceId) void seedIn(workspaceId);
  }, [owner, workspaceId]);
}

export interface TimezoneState {
  /** Persisted IANA value, or `null` while loading or unconfirmed. */
  timezone: string | null;
  /** True once we've checked the engine — false during the first roundtrip. */
  loaded: boolean;
  /** The browser-detected zone, used as a default when prompting the user. */
  detected: string;
  /** Persist a new value. */
  confirm: (tz: string) => Promise<void>;
}

/**
 * Returns the user's IANA timezone, seeded (by the SDK) with the detected
 * zone when none is stored; users change it from the Routines editor.
 */
export function useTimezonePreference(): TimezoneState {
  const target = useSeedTarget();
  const owner = target?.owner ?? null;
  const workspaceId = target?.workspaceId ?? null;
  const [reading, setReading] = useState<{
    owner: string | null;
    value: string | null;
  }>({ owner: null, value: null });

  useEffect(() => {
    if (!owner || !workspaceId) return;
    let live = true;
    void seedIn(workspaceId).then((value) => {
      if (live) setReading({ owner, value });
    });
    return () => {
      live = false;
    };
  }, [owner, workspaceId]);

  const confirm = useCallback(
    async (tz: string) => {
      await tauriPreferences.set(TIMEZONE_PREFERENCE, tz);
      setReading({ owner, value: tz });
    },
    [owner],
  );
  const loaded = owner !== null && reading.owner === owner;

  return {
    timezone: loaded ? reading.value : null,
    loaded,
    detected: detectTimezone(),
    confirm,
  };
}
