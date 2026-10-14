/**
 * Seeding the account `timezone` preference. The cloud scheduler fires
 * routines and the morning briefing in it, so every surface seeds it for every
 * signed-in person, not only on a screen that shows it.
 *
 * The rule, once, for every surface: read first, and a stored zone is the
 * answer, untouched. Only an empty key gets a write: the zone this device kept
 * before the preference moved to the account, else the device's detected
 * zone, sent CREATE-ONLY (`onlyIfAbsent: true`), so a server that has it
 * settles a race with an explicit choice in the choice's favour (412, the
 * stored value adopted). The read comes first so a gateway that predates
 * `onlyIfAbsent` (and writes unconditionally) still never overwrites a zone
 * the person chose.
 */

export const TIMEZONE_PREFERENCE = "timezone";

export interface TimezoneSeedInput {
  /** The device's IANA zone. */
  detected: string;
  /** A zone this device kept before the preference lived on the account. */
  legacy?: string | null;
}

/** `seeded`: written now. `stored`: the account already had one, untouched. */
export type TimezoneSeedResult =
  | { kind: "seeded"; timezone: string; source: "legacy" | "detected" }
  | { kind: "stored"; timezone: string };

export async function seedTimezone(
  io: {
    get(key: string): Promise<string | null>;
    create(
      key: string,
      value: string,
    ): Promise<{ created: boolean; value: string }>;
  },
  input: TimezoneSeedInput,
): Promise<TimezoneSeedResult> {
  const stored = (await io.get(TIMEZONE_PREFERENCE))?.trim();
  if (stored) return { kind: "stored", timezone: stored };
  const legacy = input.legacy?.trim();
  const out = await io.create(TIMEZONE_PREFERENCE, legacy || input.detected);
  if (!out.created) return { kind: "stored", timezone: out.value };
  return {
    kind: "seeded",
    timezone: out.value,
    source: legacy ? "legacy" : "detected",
  };
}
