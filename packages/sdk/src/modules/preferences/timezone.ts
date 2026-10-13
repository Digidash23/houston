/**
 * Seeding the account `timezone` preference. The cloud scheduler fires
 * routines and the morning briefing in it, so every surface seeds it for every
 * signed-in person once per session, not only on a screen that shows it.
 *
 * The rule, once, for every surface: a stored zone always wins and is never
 * overwritten (the person changes it with an explicit `set`); otherwise a zone
 * this device kept before the preference moved to the account is lifted up;
 * otherwise the device's detected zone is saved. Answers are cached per
 * `scope` (one person in one space: the gateway keys preferences by org and
 * user), and concurrent seeds for one scope share one read.
 *
 * Fenced: `isCurrent` is asked after the read, in the same tick the write
 * starts and the transport reads the active space, so a read
 * started in one space never writes into the space the person switched to.
 * The one window left is a 401 refresh replaying the write after an await.
 */

export const TIMEZONE_PREFERENCE = "timezone";

export interface TimezoneSeedInput {
  /** One person in one space; a new scope seeds again. */
  scope: string;
  /** The device's IANA zone, saved only when nothing better is known. */
  detected: string;
  /** A zone this device kept before the preference lived on the account. */
  legacy?: string | null;
  /** False once the caller's person or space has moved on. */
  isCurrent?: () => boolean;
}

/** `stored`: already set, nothing written. `seeded`: written now.
 *  `superseded`: the caller moved on before the write; nothing written. */
export type TimezoneSeedResult =
  | { kind: "stored"; timezone: string }
  | { kind: "seeded"; timezone: string; source: "legacy" | "detected" }
  | { kind: "superseded" };

export interface TimezoneSeeder {
  seed(input: TimezoneSeedInput): Promise<TimezoneSeedResult>;
  /** The preference was written explicitly: read it again next time. */
  forget(): void;
}

export function createTimezoneSeeder(io: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<string | null>;
}): TimezoneSeeder {
  const known = new Map<string, string>();
  const inflight = new Map<string, Promise<TimezoneSeedResult>>();

  async function run(input: TimezoneSeedInput): Promise<TimezoneSeedResult> {
    const live = input.isCurrent ?? (() => true);
    const stored = (await io.get(TIMEZONE_PREFERENCE))?.trim();
    // No await between this check and the write below: the fence holds.
    if (!live()) return { kind: "superseded" };
    if (stored) {
      known.set(input.scope, stored);
      return { kind: "stored", timezone: stored };
    }
    const legacy = input.legacy?.trim();
    const timezone = legacy || input.detected;
    await io.set(TIMEZONE_PREFERENCE, timezone);
    known.set(input.scope, timezone);
    return { kind: "seeded", timezone, source: legacy ? "legacy" : "detected" };
  }

  return {
    seed(input) {
      const cached = known.get(input.scope);
      if (cached)
        return Promise.resolve({ kind: "stored", timezone: cached } as const);
      const pending = inflight.get(input.scope);
      if (pending) return pending;
      const started = run(input).finally(() => inflight.delete(input.scope));
      inflight.set(input.scope, started);
      return started;
    },
    forget() {
      known.clear();
    },
  };
}
