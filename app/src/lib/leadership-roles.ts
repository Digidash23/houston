/**
 * The leadership and management positions the survey's "What's your role?"
 * question offers beside the hire catalog's jobs. They describe the person
 * answering, never a job an AI Employee is hired for, so they live outside the
 * hire catalog and no hire flow ever offers them.
 *
 * The gateway accepts these ids as `role` answers (cloud's
 * scripts/gen-onboarding-catalog.mjs reads this module) and its analytics count
 * a person who holds one as a decision maker. An id is append-only once
 * shipped: stored answers carry it.
 */
export const LEADERSHIP_ROLE_IDS = [
  "founder",
  "co_founder",
  "owner",
  "ceo",
  "president",
  "managing_director",
  "general_manager",
  "coo",
  "cfo",
  "cto",
  "cmo",
  "cro",
  "vp",
  "director",
  "head_of_department",
  "partner",
  "team_lead",
  "manager",
] as const;

/** A leadership or management position a person can say they hold. */
export type LeadershipRoleId = (typeof LEADERSHIP_ROLE_IDS)[number];

export function isLeadershipRoleId(value: unknown): value is LeadershipRoleId {
  return (
    typeof value === "string" &&
    (LEADERSHIP_ROLE_IDS as readonly string[]).includes(value)
  );
}
