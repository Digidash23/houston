import {
  ONBOARDING_ANSWER_SKIPPED,
  ONBOARDING_ANSWER_SOMETHING_ELSE,
} from "@houston/wire-types";
import { type AgentRoleId, isAgentRoleId } from "./agent-role-catalog.ts";
import {
  isLeadershipRoleId,
  type LeadershipRoleId,
} from "./leadership-roles.ts";

/**
 * The survey asks the person's role from the leadership positions first, then
 * the hire catalog's own jobs, the same ones an AI Employee is hired for, so
 * the first hire can start from a job (never from a position: nobody hires an
 * AI CEO). "Something else" is the door out of both, captured with the
 * person's own words (`roleOther`, kept on the device).
 */
export const ONBOARDING_ROLE_SOMETHING_ELSE = ONBOARDING_ANSWER_SOMETHING_ELSE;

/** A role the survey offers the person: a leadership position or a job. */
export type OnboardingRoleId = AgentRoleId | LeadershipRoleId;

export type OnboardingRole =
  | OnboardingRoleId
  | typeof ONBOARDING_ROLE_SOMETHING_ELSE;

/** A declined question is a stored answer, so the survey never re-asks it. */
export const ONBOARDING_ROLE_SKIPPED = ONBOARDING_ANSWER_SKIPPED;

export type OnboardingRoleChoice =
  | OnboardingRole
  | typeof ONBOARDING_ROLE_SKIPPED;

export function isOnboardingRole(value: unknown): value is OnboardingRole {
  return (
    value === ONBOARDING_ROLE_SOMETHING_ELSE ||
    isAgentRoleId(value) ||
    isLeadershipRoleId(value)
  );
}

/** Strict: the current vocabulary alone, the values the gateway accepts. */
export function isOnboardingRoleChoice(
  value: unknown,
): value is OnboardingRoleChoice {
  return value === ONBOARDING_ROLE_SKIPPED || isOnboardingRole(value);
}

/**
 * A stored role answer in this build's vocabulary. Any other non-empty string
 * is a role this build cannot name (one a newer catalog added): the person DID
 * answer, so it reads as "Something else" rather than as a question to ask
 * again. Anything that is not a string is not an answer.
 */
export function normalizeOnboardingRoleChoice(
  value: unknown,
): OnboardingRoleChoice | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return isOnboardingRoleChoice(value) ? value : ONBOARDING_ROLE_SOMETHING_ELSE;
}
