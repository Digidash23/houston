// `.ts` extensions so the node test runner can import this module directly.
import { ONBOARDING_SURVEY_STEPS } from "../../components/onboarding/survey-steps.ts";
import type { OnboardingSurveyPreference } from "../onboarding-survey-record.ts";
import { finalize } from "./changeable.ts";
import { closingPart } from "./closing-script.ts";
import type {
  ManagerLineId,
  ManagerReach,
  Script,
  ScriptLine,
  ScriptPrompt,
  SurveyQuestion,
} from "./script-types.ts";
import { surveyAnswer, surveyAnswered } from "./survey-script.ts";
import { type TeamConversation, teamLines } from "./team-script.ts";

export { changeableAnswer } from "./changeable.ts";
export type {
  ManagerLineId,
  ManagerReach,
  ReceiptQuestion,
  Script,
  ScriptLine,
  ScriptPrompt,
  ScriptReceipt,
  SurveyQuestion,
  TeamQuestion,
} from "./script-types.ts";

/** The first-run stage the route is on (`onboarding-route.ts`). */
export type FirstRunStage = "connectAi" | "survey" | "team";

/** Everything the first-run conversation is derived from. The persisted parts
 *  (the provider, the survey record, earlier hires) make a reload resume with
 *  its history; the team answers live for the session. */
export interface FirstRunInput {
  stage: FirstRunStage;
  /** The person's first name, from their signed-in identity, for the hello. */
  firstName: string | null;
  /** The stage's own inputs are still loading: ask nothing yet. */
  loading: boolean;
  providerId: string | null;
  survey: OnboardingSurveyPreference | null;
  /** A survey answer the person chose to change. */
  editing: SurveyQuestion | null;
  /** AI Employees an interrupted run already hired. */
  earlierHires: number;
  team: TeamConversation;
  /** What the closing may say the manager does on this deployment, or null
   *  where discovery serves no manager to do it. */
  reach: ManagerReach | null;
}

const WAIT: ScriptPrompt = { kind: "wait" };

const say = (id: ManagerLineId): ScriptLine => ({
  kind: "manager",
  key: id,
  id,
});

function receipt(
  key: string,
  question: SurveyQuestion | "connectAi",
  value: string,
): ScriptLine {
  return { kind: "receipt", key, question, value, editable: false };
}

/** Survey receipts in order, stopping at the question still to ask. An
 *  answer with nothing to show (a role the retired department question
 *  answered) leaves no receipt. */
function surveyPart(
  lines: ScriptLine[],
  record: OnboardingSurveyPreference | null,
  plan: readonly SurveyQuestion[],
  editing: SurveyQuestion | null,
): SurveyQuestion | null {
  for (const question of plan) {
    if (question === editing || !surveyAnswered(record, question))
      return question;
    const answer = surveyAnswer(record, question);
    if (answer !== null)
      lines.push(receipt(`survey:${question}`, question, answer));
  }
  return null;
}

/** The manager's hello: who it is and what it does, one short line at a time,
 *  ending on the first thing to do. */
function introLines(firstName: string | null): ScriptLine[] {
  return [
    {
      kind: "manager",
      key: "hello",
      id: "hello",
      ...(firstName === null ? {} : { name: firstName }),
    },
    say("introManager"),
    say("introEmployees"),
    say("introHow"),
    say("connectIntro"),
  ];
}

/**
 * The first-run conversation: the hello, connecting the AI, the three survey
 * questions, then building the team, and the closing once the team is done
 * (`closing-script.ts`).
 */
export function firstRunScript(input: FirstRunInput): Script {
  const lines = introLines(input.firstName);
  if (input.stage === "connectAi")
    return finalize(lines, input.loading ? WAIT : { kind: "connectAi" });

  lines.push(receipt("connectAi", "connectAi", input.providerId ?? ""));
  lines.push(say("surveyIntro"));
  const asking = surveyPart(
    lines,
    input.survey,
    ONBOARDING_SURVEY_STEPS,
    input.editing,
  );
  if (asking !== null) {
    const answerable = input.editing !== null || input.stage === "survey";
    return finalize(
      lines,
      answerable && !input.loading
        ? { kind: "survey", question: asking }
        : WAIT,
    );
  }
  // Every answer is in but the route has not moved on yet: a beat, not a step.
  if (input.stage === "survey") return finalize(lines, WAIT);

  lines.push(say("teamIntro"));
  if (input.earlierHires > 0)
    lines.push({
      kind: "manager",
      key: "teamResume",
      id: "teamResume",
      count: input.earlierHires,
    });
  lines.push(...teamLines(input.team));
  if (input.team.finished)
    return finalize(lines, closingPart(lines, input.survey, input.reach));
  return finalize(lines, input.loading ? WAIT : { kind: "team" });
}

/**
 * The in-app prompt for someone who answered the job question before the
 * other two existed: only the questions in `plan` (fixed when it opened), then
 * a thank-you.
 */
export function profileScript(input: {
  plan: readonly SurveyQuestion[];
  survey: OnboardingSurveyPreference | null;
  editing: SurveyQuestion | null;
}): Script {
  const lines: ScriptLine[] = [say("profileIntro")];
  const asking = surveyPart(lines, input.survey, input.plan, input.editing);
  if (asking !== null)
    return finalize(lines, { kind: "survey", question: asking });
  lines.push(say("profileThanks"));
  return finalize(lines, { kind: "finish" });
}
