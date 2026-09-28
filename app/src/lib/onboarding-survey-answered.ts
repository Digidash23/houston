import type { OnboardingSurveyPreference } from "./onboarding-survey-record.ts";

/** A department answered before the role question replaced it counts: an
 *  existing account is never asked its role. */
export function isRoleAnswered(
  preference: OnboardingSurveyPreference | null,
): boolean {
  return (
    preference !== null &&
    (preference.role !== null || preference.segment !== null)
  );
}

export function isIndustryAnswered(
  preference: OnboardingSurveyPreference | null,
): boolean {
  return preference !== null && preference.industry !== null;
}

export function isCompanySizeAnswered(
  preference: OnboardingSurveyPreference | null,
): boolean {
  return preference !== null && preference.companySize !== null;
}

export function isGoalAnswered(
  preference: OnboardingSurveyPreference | null,
): boolean {
  return (
    preference !== null &&
    (preference.automationGoal !== null || preference.goalSkipped)
  );
}

/**
 * The survey is resumable: an answered role with a gap re-opens it once. A
 * question added after the person answered the others (the company size) is
 * such a gap, so every existing account is asked it once, and "Not now" is
 * remembered for good.
 */
export function needsCompletionPrompt(
  preference: OnboardingSurveyPreference | null,
): boolean {
  if (preference === null || preference.completionPromptDismissed) return false;
  return (
    isRoleAnswered(preference) &&
    (!isIndustryAnswered(preference) ||
      !isCompanySizeAnswered(preference) ||
      !isGoalAnswered(preference))
  );
}
