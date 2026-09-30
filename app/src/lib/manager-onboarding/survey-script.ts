// `.ts` extensions so the node test runner can import this module directly.
import { ONBOARDING_ANSWER_SKIPPED } from "@houston/wire-types";
import {
  isCompanySizeAnswered,
  isGoalAnswered,
  isIndustryAnswered,
  isOnboardingCompanySize,
  isRoleAnswered,
  type OnboardingCompanySize,
  type OnboardingSurveyPreference,
} from "../onboarding-survey.ts";
import type { SurveyQuestion } from "./script-types.ts";

/** A declined question is still an answer: the survey never re-asks it. */
export const SURVEY_SKIPPED = ONBOARDING_ANSWER_SKIPPED;

/** Whether a question is answered, so the survey moves past it. A department
 *  answered before the role question existed answers the role. */
export function surveyAnswered(
  record: OnboardingSurveyPreference | null,
  question: SurveyQuestion,
): boolean {
  if (question === "industry") return isIndustryAnswered(record);
  if (question === "role") return isRoleAnswered(record);
  if (question === "companySize") return isCompanySizeAnswered(record);
  return isGoalAnswered(record);
}

/** "Something else" is shown as the words the person gave, when this device
 *  holds them (they never leave it). */
function withWords(id: string | null, words: string | null): string | null {
  return id === "something_else" && words !== null ? words : id;
}

/**
 * A question's answer as its receipt shows it: a catalog id, a company-size
 * bucket, the person's own words, or {@link SURVEY_SKIPPED}. Null while it is unanswered, and for a
 * role answered only by the retired department question, which has no words
 * to show and no receipt.
 */
export function surveyAnswer(
  record: OnboardingSurveyPreference | null,
  question: SurveyQuestion,
): string | null {
  if (!record) return null;
  if (question === "industry")
    return withWords(record.industry, record.industryOther);
  if (question === "role") return withWords(record.role, record.roleOther);
  if (question === "companySize") return record.companySize;
  if (record.automationGoal !== null) return record.automationGoal;
  return record.goalSkipped ? SURVEY_SKIPPED : null;
}

/**
 * What the goal handoff tells the manager about the person, from the survey:
 * the industry and role as their receipts hold them and the company size, each null where
 * there is nothing to say (unanswered, skipped, or "Something else" with no
 * words on this device).
 */
export function surveyAbout(record: OnboardingSurveyPreference | null): {
  industry: string | null;
  role: string | null;
  companySize: OnboardingCompanySize | null;
} {
  const role = surveyAnswer(record, "role");
  const industry = surveyAnswer(record, "industry");
  const size = record?.companySize ?? null;
  return {
    industry:
      industry === null ||
      industry === SURVEY_SKIPPED ||
      industry === "something_else"
        ? null
        : industry,
    role:
      role === null || role === SURVEY_SKIPPED || role === "something_else"
        ? null
        : role,
    companySize: isOnboardingCompanySize(size) ? size : null,
  };
}
