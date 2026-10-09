// Dependency-free on purpose: `app/tests` imports this under node:test.

import type { CloudMigrationOutcome } from "../hooks/cloud-migration-trigger";

/**
 * The wizard's outcome for THIS machine. The migration reads this machine's
 * `~/.houston` tree once, so the record belongs to the device, not to whoever
 * is signed in: sign-out keeps it (`DEVICE_LOCAL_KEY_PREFIXES` in
 * `houston-local-state.ts`) and every account on the machine honors it. Any
 * account can still re-run from Settings, which clears it.
 */
export const CLOUD_MIGRATION_OUTCOME_KEY = "houston.cloudMigration.outcome";

/** Builds before the device key wrote `houston.cloudMigration.<uid>`, which
 *  sign-out purged. A surviving one is promoted to the device key on read. */
const LEGACY_PER_USER_PREFIX = "houston.cloudMigration.";

/** The slice of the Web Storage API the outcome needs. */
export interface OutcomeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function parse(raw: string | null): CloudMigrationOutcome | null {
  return raw === "done" || raw === "skipped" ? raw : null;
}

/** This machine's outcome, or `null` when the wizard never finished here.
 *  Throws what the storage throws; callers report it. */
export function readCloudMigrationOutcome(
  storage: OutcomeStorage,
  userId: string | null,
): CloudMigrationOutcome | null {
  const outcome = parse(storage.getItem(CLOUD_MIGRATION_OUTCOME_KEY));
  if (outcome || !userId) return outcome;
  const legacyKey = LEGACY_PER_USER_PREFIX + userId;
  const legacy = parse(storage.getItem(legacyKey));
  if (legacy) {
    storage.setItem(CLOUD_MIGRATION_OUTCOME_KEY, legacy);
    storage.removeItem(legacyKey);
  }
  return legacy;
}

export function writeCloudMigrationOutcome(
  storage: OutcomeStorage,
  outcome: CloudMigrationOutcome,
): void {
  storage.setItem(CLOUD_MIGRATION_OUTCOME_KEY, outcome);
}

/** Forget the outcome so the wizard reopens on the next boot (Settings re-run). */
export function clearCloudMigrationOutcome(
  storage: OutcomeStorage,
  userId: string | null,
): void {
  storage.removeItem(CLOUD_MIGRATION_OUTCOME_KEY);
  if (userId) storage.removeItem(LEGACY_PER_USER_PREFIX + userId);
}
