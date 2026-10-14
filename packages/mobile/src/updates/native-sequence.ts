const PREFIX = "houston.ota.native_builtin_sequence.";

/** The store bundle records its native baseline before any OTA code can run. */
export function nativeBuiltinSequence(
  channel: "production" | "preview",
  nativeBuild: string,
  baked: number,
  storage: Pick<Storage, "getItem" | "setItem">,
): number {
  const key = `${PREFIX}${channel}.${nativeBuild}`;
  const saved = storage.getItem(key);
  const value = saved === null || saved.trim() === "" ? NaN : Number(saved);
  if (!Number.isSafeInteger(value) || value < 0) {
    storage.setItem(key, String(baked));
    return baked;
  }
  return value;
}

/** Highest OTA sequence applied on one native build of one channel. */
export function otaSequenceKey(
  channel: "production" | "preview",
  nativeBuild: string,
): string {
  return `houston.ota.sequence.${channel}.${nativeBuild}`;
}

/** Newest authenticated required-update policy of one channel. */
export function otaPolicyKey(channel: "production" | "preview"): string {
  return `houston.ota.policy.${channel}`;
}

/**
 * Builds before per-build sequences kept one `houston.ota.sequence.<channel>`.
 * Its value is the newest manifest that install accepted, so it seeds the
 * policy floor once (no native requirement known: 1) and is then removed;
 * without it the first check after the update would accept an older replay.
 */
export function migrateLegacyOtaSequence(
  channel: "production" | "preview",
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): void {
  const legacyKey = `houston.ota.sequence.${channel}`;
  const legacy = storage.getItem(legacyKey);
  if (legacy === null) return;
  const sequence = Number(legacy);
  if (
    storage.getItem(otaPolicyKey(channel)) === null &&
    legacy.trim() !== "" &&
    Number.isSafeInteger(sequence) &&
    sequence > 0
  )
    storage.setItem(
      otaPolicyKey(channel),
      JSON.stringify({ sequence, required_native_build: 1 }),
    );
  storage.removeItem(legacyKey);
}
