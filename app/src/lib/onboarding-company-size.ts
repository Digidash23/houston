import {
  ONBOARDING_ANSWER_SKIPPED,
  ONBOARDING_COMPANY_SIZES,
  type OnboardingCompanySizeWire,
} from "@houston/wire-types";

/**
 * How big the person's company is, one of the survey's buckets, smallest
 * first. The buckets are the wire's own closed set (`@houston/wire-types`).
 */
export const ONBOARDING_COMPANY_SIZE_IDS = ONBOARDING_COMPANY_SIZES;

export type OnboardingCompanySize = OnboardingCompanySizeWire;

/** A declined question is a stored answer, so the survey never re-asks it. */
export const ONBOARDING_COMPANY_SIZE_SKIPPED = ONBOARDING_ANSWER_SKIPPED;

export type OnboardingCompanySizeChoice =
  | OnboardingCompanySize
  | typeof ONBOARDING_COMPANY_SIZE_SKIPPED;

export function isOnboardingCompanySize(
  value: unknown,
): value is OnboardingCompanySize {
  return (
    typeof value === "string" &&
    (ONBOARDING_COMPANY_SIZE_IDS as readonly string[]).includes(value)
  );
}

export function isOnboardingCompanySizeChoice(
  value: unknown,
): value is OnboardingCompanySizeChoice {
  return (
    value === ONBOARDING_COMPANY_SIZE_SKIPPED || isOnboardingCompanySize(value)
  );
}

/**
 * A stored company size in this build's vocabulary, else null. Unlike a role,
 * a bucket this build cannot name has no "Something else" to read as, and
 * asking the one-tap question again costs the person a single tap.
 */
export function normalizeOnboardingCompanySizeChoice(
  value: unknown,
): OnboardingCompanySizeChoice | null {
  return isOnboardingCompanySizeChoice(value) ? value : null;
}
