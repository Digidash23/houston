import {
  normalizeOnboardingCompanySizeChoice,
  type OnboardingCompanySizeChoice,
} from "./onboarding-company-size.ts";
import {
  normalizeOnboardingIndustryChoice,
  type OnboardingIndustryChoice,
} from "./onboarding-industry.ts";
import {
  normalizeOnboardingRoleChoice,
  type OnboardingRoleChoice,
} from "./onboarding-role.ts";

export const ONBOARDING_SURVEY_PREF_KEY = "houston_onboarding_survey";
export const ONBOARDING_SURVEY_VERSION = 2;
/** Max length of the automation goal, in Unicode CODE POINTS — the unit the
 *  gateway counts (Go runes). Counting UTF-16 units instead would refuse an
 *  emoji answer the server accepts. */
export const ONBOARDING_GOAL_MAX_LENGTH = 2000;
/** Max length of a "Something else" free-text answer, in code points. */
export const ONBOARDING_OTHER_MAX_LENGTH = 200;

export interface OnboardingSurveyPreference {
  version: typeof ONBOARDING_SURVEY_VERSION;
  /** The retired department question, kept from records answered before the
   *  role question replaced it: it counts the role as answered. Never written
   *  by this app, only carried. */
  segment: string | null;
  role: OnboardingRoleChoice | null;
  /** What "Something else" stands for, in the user's words — captured with the
   *  pick, null for every catalog role. */
  roleOther: string | null;
  industry: OnboardingIndustryChoice | null;
  industryOther: string | null;
  /** Absent from records written before the question existed: it reads as
   *  unanswered, so the profile-completion prompt asks it once. */
  companySize: OnboardingCompanySizeChoice | null;
  automationGoal: string | null;
  goalSkipped: boolean;
  completionPromptDismissed: boolean;
  updatedAt: string;
  /** ISO of the last successful gateway PUT; null means the record is unsynced. */
  gatewaySyncedAt: string | null;
}

export function isValidAutomationGoal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Spread, not `.length`: an astral character (emoji) is ONE code point to the
  // gateway and two UTF-16 units here, and the two counts must agree.
  const length = [...value.trim()].length;
  return length > 0 && length <= ONBOARDING_GOAL_MAX_LENGTH;
}

export function isValidOtherText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const length = [...value.trim()].length;
  return length > 0 && length <= ONBOARDING_OTHER_MAX_LENGTH;
}

/** The "other" fields parse LENIENTLY (absent or malformed → null): records
 *  written before the fields existed must keep parsing, and a mangled label
 *  is not worth re-asking three answered questions for. */
function otherTextOrNull(value: unknown): string | null {
  return isValidOtherText(value) ? value.trim() : null;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** The legacy department reads as any non-empty string: its vocabulary is
 *  retired, and an answer must never turn back into a question. */
function legacySegmentOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * All-or-nothing on the fields every record has always carried: a missing one
 * or an unknown goal means the stored blob is not ours, and re-asking the
 * survey beats rendering a half-trusted record. The role pair, the company
 * size and the legacy department read leniently (`version` 2 records were
 * written before the role and the company size existed, and after the
 * department was retired), and an unknown role still counts as answered
 * (`normalizeOnboardingRoleChoice`).
 */
export function parseOnboardingSurveyPreference(
  raw: string | null,
): OnboardingSurveyPreference | null {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Partial<OnboardingSurveyPreference>;
  if (record.version !== ONBOARDING_SURVEY_VERSION) return null;
  // The industry alone reads leniently: legacy survey ids and contexts this
  // build cannot name are still answers (`normalizeOnboardingIndustryChoice`).
  const industry =
    record.industry === null
      ? null
      : normalizeOnboardingIndustryChoice(record.industry);
  if (record.industry !== null && industry === null) return null;
  if (
    record.automationGoal !== null &&
    !isValidAutomationGoal(record.automationGoal)
  )
    return null;
  if (typeof record.goalSkipped !== "boolean") return null;
  if (typeof record.completionPromptDismissed !== "boolean") return null;
  if (!isIsoTimestamp(record.updatedAt)) return null;
  if (
    record.gatewaySyncedAt !== null &&
    !isIsoTimestamp(record.gatewaySyncedAt)
  )
    return null;
  return {
    version: ONBOARDING_SURVEY_VERSION,
    segment: legacySegmentOrNull(record.segment),
    role: normalizeOnboardingRoleChoice(record.role),
    roleOther: otherTextOrNull(record.roleOther),
    industry,
    industryOther: otherTextOrNull(record.industryOther),
    companySize: normalizeOnboardingCompanySizeChoice(record.companySize),
    automationGoal: record.automationGoal?.trim() ?? null,
    goalSkipped: record.goalSkipped,
    completionPromptDismissed: record.completionPromptDismissed,
    updatedAt: record.updatedAt,
    gatewaySyncedAt: record.gatewaySyncedAt,
  };
}

export function serializeOnboardingSurveyPreference(
  preference: OnboardingSurveyPreference,
): string {
  return JSON.stringify(preference);
}

export function createOnboardingSurveyPreference(): OnboardingSurveyPreference {
  return {
    version: ONBOARDING_SURVEY_VERSION,
    segment: null,
    role: null,
    roleOther: null,
    industry: null,
    industryOther: null,
    companySize: null,
    automationGoal: null,
    goalSkipped: false,
    completionPromptDismissed: false,
    updatedAt: new Date().toISOString(),
    gatewaySyncedAt: null,
  };
}

/**
 * Whether two copies of the record hold the same ANSWERS. Everything else (`updatedAt`, the sync stamp, the
 * dismissal) is metadata about them, so this is the predicate that decides
 * whether a stamp still describes what it was written for.
 */
export function sameSurveyAnswers(
  a: OnboardingSurveyPreference,
  b: OnboardingSurveyPreference,
): boolean {
  return (
    a.segment === b.segment &&
    a.role === b.role &&
    a.roleOther === b.roleOther &&
    a.industry === b.industry &&
    a.industryOther === b.industryOther &&
    a.companySize === b.companySize &&
    a.automationGoal === b.automationGoal &&
    a.goalSkipped === b.goalSkipped
  );
}

/** Stamps a successful gateway PUT; not a content change, so `updatedAt` holds. */
export function markGatewaySynced(
  preference: OnboardingSurveyPreference,
  syncedAt: string,
): OnboardingSurveyPreference {
  if (!isIsoTimestamp(syncedAt))
    throw new RangeError("gateway sync stamp must be an ISO 8601 timestamp");
  return { ...preference, gatewaySyncedAt: syncedAt };
}

/**
 * Per-user localStorage key for the device-local mirror: the engine pref lives
 * on the user's pod in hosted mode, so a pod blip must not re-prompt an
 * answered survey, and keying by uid keeps two accounts on one machine
 * independent.
 */
export function onboardingSurveyLocalKey(uid: string | null): string {
  return `houston.onboarding-survey.${uid ?? "local"}`;
}
