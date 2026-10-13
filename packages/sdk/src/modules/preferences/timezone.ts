/**
 * Seeding the account `timezone` preference. The cloud scheduler fires
 * routines and the morning briefing in it, so every surface seeds it for every
 * signed-in person, not only on a screen that shows it.
 *
 * The rule, once, for every surface: the zone this device kept before the
 * preference moved to the account, else the device's detected zone, written
 * CREATE-ONLY (`onlyIfAbsent: true`). The server writes it only when the key
 * holds nothing, so a stored zone always wins: an explicit choice is never
 * overwritten, and a seed that outlived a space switch lands in (or is
 * refused by) the space its transport was pinned to, never another.
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
  create: (
    key: string,
    value: string,
  ) => Promise<{ created: boolean; value: string }>,
  input: TimezoneSeedInput,
): Promise<TimezoneSeedResult> {
  const legacy = input.legacy?.trim();
  const out = await create(TIMEZONE_PREFERENCE, legacy || input.detected);
  if (!out.created) return { kind: "stored", timezone: out.value };
  return {
    kind: "seeded",
    timezone: out.value,
    source: legacy ? "legacy" : "detected",
  };
}
