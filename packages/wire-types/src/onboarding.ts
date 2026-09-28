/**
 * The account's onboarding survey as the gateway stores it:
 * `GET /v1/me/onboarding` answers {@link OnboardingRecordWire}, and
 * `PUT /v1/me/onboarding` takes a non-empty {@link OnboardingUpdateWire}.
 * Both are USER-scoped (never a space), so neither carries `x-houston-org`.
 *
 * Ids are plain strings on the wire: a value one build does not know (an id a
 * newer catalog added) must not poison another build's read. What each field
 * may hold is stated here; the client validates against its own catalog.
 */

/** A question the person declined: a stored answer, so it is never re-asked. */
export const ONBOARDING_ANSWER_SKIPPED = "skipped";

/** The door out of a catalog: the person answered in their own words, which
 *  stay on their device. */
export const ONBOARDING_ANSWER_SOMETHING_ELSE = "something_else";

/** The 400 a PUT answers when `role` is none of the accepted values. */
export const ONBOARDING_INVALID_ROLE = "invalid_role";

/**
 * How many people work at the person's company, as the survey buckets it,
 * smallest first. A closed set both sides hold: a new bucket is a wire change.
 */
export const ONBOARDING_COMPANY_SIZES = [
  "solo",
  "2_10",
  "11_50",
  "51_200",
  "201_1000",
  "1000_plus",
] as const;

export type OnboardingCompanySizeWire =
  (typeof ONBOARDING_COMPANY_SIZES)[number];

/** `GET /v1/me/onboarding`. Each `*AnsweredAt` is an ISO stamp, null while
 *  the question is unanswered. */
export interface OnboardingRecordWire {
  /** The retired department question, held for rows answered before the role
   *  question replaced it. No current client writes it. */
  segment: string | null;
  /** A hire-catalog role id, a leadership position id,
   *  {@link ONBOARDING_ANSWER_SOMETHING_ELSE} or {@link ONBOARDING_ANSWER_SKIPPED}. */
  role: string | null;
  /** A hire-catalog industry (context) id, "something_else" or "skipped". */
  industry: string | null;
  /** One of {@link ONBOARDING_COMPANY_SIZES} or "skipped". */
  companySize: string | null;
  automationGoal: string | null;
  goalSkipped: boolean;
  segmentAnsweredAt: string | null;
  roleAnsweredAt: string | null;
  industryAnsweredAt: string | null;
  companySizeAnsweredAt: string | null;
  goalAnsweredAt: string | null;
}

/**
 * `PUT /v1/me/onboarding`: any non-empty subset. A field whose answer changes
 * is stored and stamps its `*AnsweredAt`; one sent unchanged moves nothing. A
 * `role` outside the accepted values answers 400
 * {@link ONBOARDING_INVALID_ROLE}. `segment` stays accepted for older clients
 * and is never sent by a current one.
 */
export interface OnboardingUpdateWire {
  role?: string;
  industry?: string;
  companySize?: string;
  automationGoal?: string;
  goalSkipped?: boolean;
  segment?: string;
}
