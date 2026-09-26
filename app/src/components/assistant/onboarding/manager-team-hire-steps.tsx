import { nextTeamView } from "../../onboarding/team/team-view-model";
import { ContextStep } from "../../shell/context-step";
import type { RoleQuestionAnswer } from "../../shell/role-question";
import { ManagerQuestionStep } from "./manager-question-step";
import type { TeamCardProps } from "./manager-team-question-cards";

/** A pick's value on its receipt: the catalog id, or the words typed. */
const answerValue = (answer: RoleQuestionAnswer<string>) =>
  answer.kind === "catalog" ? answer.id : answer.label;

/** The starter team's industry, asked first only when the survey left none,
 *  with the create sheet's own industry question. */
export function BasicIndustryStep({
  team,
  view,
  onAnswer,
  onBack,
}: TeamCardProps) {
  const state = team.industryState;
  const { contextId } = state;
  const next = nextTeamView(view);
  const industry = (value: string) =>
    onAnswer({ question: "teamIndustry", value }, next);
  return (
    <ManagerQuestionStep
      id="team-basic-industry"
      onBack={onBack}
      onContinue={contextId === null ? null : () => industry(contextId)}
    >
      <ContextStep
        state={state}
        onAnswered={(answer) => industry(answerValue(answer))}
      />
    </ManagerQuestionStep>
  );
}
