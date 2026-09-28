import {
  createOnboardingSurveyPreference,
  type OnboardingSurveyPreference,
} from "./onboarding-survey-record.ts";

/**
 * The pre-survey `houston_onboarding_segment` preference: the department
 * question first-run asked before the survey existed. Nothing writes it any
 * more; it is read once, to lift an account that answered it into the survey
 * record, where the answer counts the role question as answered.
 */

export const ONBOARDING_SEGMENT_PREF_KEY = "houston_onboarding_segment";

/** The screen every legacy record names: a record naming another is not one. */
const LEGACY_SOURCE_SCREEN = "first_run_segment";

export interface LegacySegmentPreference {
  /** The department as it was stored. Read as an answer, never as a
   *  vocabulary: the department list is retired. */
  segment: string;
  selectedAt: string;
}

/** Lenient on the answer (any non-empty string was an answer), strict on the
 *  record's shape, so a blob that is not ours never counts as one. */
export function parseLegacySegmentPreference(
  raw: string | null,
): LegacySegmentPreference | null {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.segment !== "string" ||
    record.segment.trim() === "" ||
    typeof record.selectedAt !== "string" ||
    record.sourceScreen !== LEGACY_SOURCE_SCREEN
  )
    return null;
  return { segment: record.segment, selectedAt: record.selectedAt };
}

/** Per-user localStorage key the legacy segment hook mirrored the answer to,
 *  first: an answer whose engine write failed survived only there. */
export function onboardingSegmentLocalKey(uid: string | null): string {
  return `houston.onboarding-segment.${uid ?? "local"}`;
}

/**
 * Builds a survey record from the legacy pref. The legacy pref stays where it
 * is (rollback safety); the survey record becomes the only thing read from
 * here on.
 */
export function liftLegacySegmentPreference(
  legacy: LegacySegmentPreference | null,
): OnboardingSurveyPreference | null {
  if (!legacy) return null;
  return {
    ...createOnboardingSurveyPreference(),
    segment: legacy.segment,
    // An unparseable stamp falls back to the factory's `now` rather than
    // minting a record the survey's strict parser would then reject.
    updatedAt: Number.isNaN(Date.parse(legacy.selectedAt))
      ? new Date().toISOString()
      : legacy.selectedAt,
  };
}
