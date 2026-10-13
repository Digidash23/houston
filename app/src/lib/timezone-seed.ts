/**
 * The account `timezone` preference: read it, and when the person has never
 * set one, save the device's detected zone. Never overwrites a stored value
 * (the Routines editor's picker is how a person changes it).
 *
 * The cloud scheduler fires routines and the morning briefing on this value,
 * so the app shell seeds it once per session for every signed-in person
 * (`useTimezoneSeed`), not only when a screen that shows it mounts. A
 * preference belongs to one person in one space (the gateway keys it by org
 * and user), so the cache is held per {@link TimezoneSeed.forOwner} key and a
 * new person or a new space seeds again.
 *
 * Reads and writes go through the engine's preference calls (bound to
 * `@houston/sdk`); this module only decides when.
 */

import { orgSlugFromWorkspaceId } from "./space-id";

export const TIMEZONE_KEY = "timezone";

export interface TimezonePrefs {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
}

export interface TimezoneSeedDeps {
  prefs: TimezonePrefs;
  detect: () => string;
  report: (command: string, err: unknown) => void;
}

export interface TimezoneReading {
  /** The effective IANA zone, or `null` until the first read settles. */
  value: string | null;
  loaded: boolean;
}

export interface TimezoneSeed {
  /** Bind the session to one person in one space, then seed once for them. */
  forOwner(owner: string): Promise<string | null>;
  /** Read (seeding when unset) once per owner; later calls share the answer. */
  load(): Promise<string | null>;
  /** Save a zone the person chose. */
  set(tz: string): Promise<void>;
  current(): TimezoneReading;
  subscribe(fn: () => void): () => void;
}

/** The device's IANA zone, `UTC` when the runtime cannot say. */
export function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz?.length) return tz;
  } catch {
    // An Intl without zone data: UTC is the only safe answer.
  }
  return "UTC";
}

/**
 * The seed key: one person in one space, or null until both are known. A
 * deployment with no identity (local, self-host) has exactly one person.
 */
export function timezoneOwner(
  uid: string | null,
  identityConfigured: boolean,
  workspaceId: string | null,
): string | null {
  const person = identityConfigured ? uid : "local";
  if (!person || !workspaceId) return null;
  return `${person}:${orgSlugFromWorkspaceId(workspaceId) ?? "personal"}`;
}

export function createTimezoneSeed(deps: TimezoneSeedDeps): TimezoneSeed {
  let owner: string | null = null;
  let reading: TimezoneReading = { value: null, loaded: false };
  let inflight: Promise<string | null> | null = null;
  // Bumped per owner, so a read started for the previous person or space
  // never lands in the next one's cache.
  let generation = 0;
  const subscribers = new Set<() => void>();
  const notify = () => {
    for (const fn of subscribers) fn();
  };

  async function seedIfUnset(): Promise<string> {
    const stored = await deps.prefs.get(TIMEZONE_KEY);
    if (stored?.trim()) return stored;
    const detected = deps.detect();
    await deps.prefs.set(TIMEZONE_KEY, detected);
    return detected;
  }

  async function read(gen: number): Promise<string | null> {
    let value: string;
    try {
      value = await seedIfUnset();
    } catch (err) {
      // The engine never learned the zone, so routines fire in the host's
      // zone until a later session saves it. The screen still renders the
      // detected value meanwhile.
      deps.report("timezone_seed", err);
      value = deps.detect();
    }
    if (gen === generation) {
      reading = { value, loaded: true };
      notify();
    }
    return value;
  }

  function load(): Promise<string | null> {
    if (reading.loaded) return Promise.resolve(reading.value);
    if (inflight) return inflight;
    const gen = generation;
    const pending = read(gen).finally(() => {
      if (gen === generation) inflight = null;
    });
    inflight = pending;
    return pending;
  }

  return {
    forOwner(next) {
      if (next !== owner) {
        owner = next;
        generation += 1;
        inflight = null;
        reading = { value: null, loaded: false };
        notify();
      }
      return load();
    },
    load,
    async set(tz) {
      await deps.prefs.set(TIMEZONE_KEY, tz);
      // The person's choice wins over a read still in flight.
      generation += 1;
      inflight = null;
      reading = { value: tz, loaded: true };
      notify();
    },
    current: () => reading,
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
