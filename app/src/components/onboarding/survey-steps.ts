// `.ts` extension so the node test runner (extensionless ESM can't resolve)
// can import this pure helper directly, matching the repo's tested-module
// convention.

/**
 * Pure step logic for the onboarding survey, extracted so the progression, the
 * analytics source screen, and the "what is still missing" report are unit
 * testable without rendering React.
 *
 * The survey asks four questions in this order: the industry first, because
 * it decides which roles the next question leads with, then the role, the
 * company's size, and the goal. The ids are the analytics and preference
 * vocabulary, so a plan can be reported verbatim as the `missing_steps` prop.
 */
export const ONBOARDING_SURVEY_STEPS = [
  "industry",
  "role",
  "companySize",
  "goal",
] as const;

export type OnboardingSurveyStep = (typeof ONBOARDING_SURVEY_STEPS)[number];

export function isSurveyQuestion(value: string): value is OnboardingSurveyStep {
  return (ONBOARDING_SURVEY_STEPS as readonly string[]).includes(value);
}

/**
 * Where the survey is being shown: the first run (every question, after
 * connecting the AI and before the team) or the in-app prompt that re-opens it
 * for someone who left questions unanswered (one added after they answered
 * the rest included).
 */
export type OnboardingSurveyMode = "first_run" | "profile_completion";

/** The answered flags the survey hook exposes, in step order. */
export interface OnboardingSurveyAnswered {
  industryAnswered: boolean;
  roleAnswered: boolean;
  companySizeAnswered: boolean;
  goalAnswered: boolean;
}

const ANSWERED_FLAG: Record<
  OnboardingSurveyStep,
  keyof OnboardingSurveyAnswered
> = {
  industry: "industryAnswered",
  role: "roleAnswered",
  companySize: "companySizeAnswered",
  goal: "goalAnswered",
};

const STEP_VIEWED_EVENT = {
  industry: "onboarding_industry_screen_viewed",
  role: "onboarding_role_screen_viewed",
  companySize: "onboarding_company_size_screen_viewed",
  goal: "onboarding_goal_screen_viewed",
} as const;

/** The questions still unanswered, in ask order. */
export function missingSurveySteps(
  answered: OnboardingSurveyAnswered,
): OnboardingSurveyStep[] {
  return ONBOARDING_SURVEY_STEPS.filter(
    (step) => !answered[ANSWERED_FLAG[step]],
  );
}

/**
 * Which questions this mounting asks. The first-run intro always walks the
 * whole survey (a resumed first run keeps its earlier answers preselected);
 * the in-app prompt only fills the gaps, so nobody is re-asked what they
 * already answered.
 */
export function surveyStepPlan(
  mode: OnboardingSurveyMode,
  answered: OnboardingSurveyAnswered,
): OnboardingSurveyStep[] {
  if (mode === "first_run") return [...ONBOARDING_SURVEY_STEPS];
  return missingSurveySteps(answered);
}

/** PostHog's `source_screen` for every survey event of a first run. */
const FIRST_RUN_SURVEY_SOURCE_SCREEN = "first_run_role";

/** PostHog's `source_screen` for this mounting. */
export function surveySourceScreen(mode: OnboardingSurveyMode): string {
  return mode === "first_run"
    ? FIRST_RUN_SURVEY_SOURCE_SCREEN
    : "profile_completion";
}

/** The `*_screen_viewed` event a step fires when it becomes the visible one. */
export function surveyStepViewedEvent(
  step: OnboardingSurveyStep,
): (typeof STEP_VIEWED_EVENT)[OnboardingSurveyStep] {
  return STEP_VIEWED_EVENT[step];
}
