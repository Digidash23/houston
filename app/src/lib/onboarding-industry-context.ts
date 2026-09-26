import {
  type AgentContextId,
  type AgentRoleId,
  isAgentContextId,
  isAgentRoleId,
} from "./agent-role-catalog.ts";
import {
  isLeadershipRoleId,
  type LeadershipRoleId,
} from "./leadership-roles.ts";
import { ONBOARDING_INDUSTRY_SOMETHING_ELSE } from "./onboarding-industry.ts";
import { ONBOARDING_ROLE_SOMETHING_ELSE } from "./onboarding-role.ts";
import type { OnboardingSurveyPreference } from "./onboarding-survey-record.ts";

/**
 * The person's industry as the hire flow's context question takes it: a
 * catalog context to preselect, or the words they gave for an industry the
 * catalog does not list. Both null means there is nothing to preselect (the
 * question is unanswered, or was declined).
 */
export interface SurveyIndustryContext {
  contextId: AgentContextId | null;
  customLabel: string | null;
}

const NO_INDUSTRY: SurveyIndustryContext = {
  contextId: null,
  customLabel: null,
};

export function surveyIndustryContext(
  record: Pick<OnboardingSurveyPreference, "industry" | "industryOther"> | null,
): SurveyIndustryContext {
  if (!record) return NO_INDUSTRY;
  if (isAgentContextId(record.industry))
    return { contextId: record.industry, customLabel: null };
  if (record.industry === ONBOARDING_INDUSTRY_SOMETHING_ELSE)
    return { contextId: null, customLabel: record.industryOther };
  return NO_INDUSTRY;
}

/** The person's role as the hire flow's role question takes it, the same way:
 *  a catalog role, or their own words. A leadership position is neither: it
 *  describes the person, never a job to hire for, so it preselects nothing
 *  (the industry still does). */
export interface SurveyRoleContext {
  roleId: AgentRoleId | null;
  customLabel: string | null;
}

export const NO_SURVEY_ROLE: SurveyRoleContext = {
  roleId: null,
  customLabel: null,
};

export function surveyRoleContext(
  record: Pick<OnboardingSurveyPreference, "role" | "roleOther"> | null,
): SurveyRoleContext {
  if (!record) return NO_SURVEY_ROLE;
  if (isAgentRoleId(record.role))
    return { roleId: record.role, customLabel: null };
  if (record.role === ONBOARDING_ROLE_SOMETHING_ELSE)
    return { roleId: null, customLabel: record.roleOther };
  return NO_SURVEY_ROLE;
}

/** The leadership position the person answered with, which the survey's own
 *  role question preselects when the answer is changed; null for anything
 *  else. */
export function surveyLeadershipRole(
  record: Pick<OnboardingSurveyPreference, "role"> | null,
): LeadershipRoleId | null {
  const role = record?.role ?? null;
  return isLeadershipRoleId(role) ? role : null;
}
