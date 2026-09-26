import { useEffect } from "react";
import type {
  TeamAnswer,
  TeamConversation,
} from "../../../lib/manager-onboarding/team-script";
import type { Agent } from "../../../lib/types";
import type { TeamView } from "../../onboarding/team/team-view-model";
import { useSurveyRoleStart } from "../../onboarding/team/use-survey-role-start";
import type { AgentRoleStart } from "../../shell/use-agent-role-state";
import { BasicTeamCard } from "./manager-team-hire-cards";
import { BasicIndustryStep } from "./manager-team-hire-steps";
import { NextCard } from "./manager-team-question-cards";
import { type TeamClosingAnswer, useManagerTeam } from "./use-manager-team";
import type { ScriptCopy } from "./use-script-copy";

export interface TeamPromptProps {
  workspaceId: string;
  conversation: TeamConversation;
  /** The AI Employees an interrupted run already hired. */
  earlierHires: readonly Agent[];
  copy: ScriptCopy;
  onAnswer: (answer: TeamAnswer, next: TeamView) => void;
  /** Reopens the latest answer, for the step's own Back, or null when it is
   *  for good. */
  onBack: (() => void) | null;
  /** Work is landing (the finish): no answer may change while it does. */
  onBusy: (busy: boolean) => void;
  onFinished: (closing: TeamClosingAnswer | null) => void;
}

/**
 * The team step of the conversation: the starter team, straight away, to
 * edit, grow ("Hire one more"), trim and hire. Its industry is asked first
 * only when the survey left none. A run resumed with AI Employees already
 * hired first asks whether to hire more or call it done. It waits for the
 * survey record, since the team takes its industry from it once.
 */
export function ManagerTeamPrompt(props: TeamPromptProps) {
  const survey = useSurveyRoleStart();
  if (survey.loading) return null;
  return <TeamSession {...props} start={survey.start} />;
}

function TeamSession({
  start,
  ...props
}: TeamPromptProps & { start: AgentRoleStart }) {
  const { onAnswer, onBusy } = props;
  const team = useManagerTeam({
    workspaceId: props.workspaceId,
    start,
    earlierHires: props.earlierHires,
    conversation: props.conversation,
    onFinished: props.onFinished,
  });
  useEffect(() => {
    onBusy(team.busy);
  }, [onBusy, team.busy]);
  const view = props.conversation.view;
  const card = { team, copy: props.copy, onAnswer, onBack: props.onBack, view };

  const resumed =
    props.earlierHires.length > 0 && props.conversation.entries.length === 0;
  if (resumed) return <NextCard {...card} />;
  if (view.kind === "basicIndustry") return <BasicIndustryStep {...card} />;
  if (view.kind === "basic")
    return team.industry === "" ? (
      <BasicIndustryStep {...card} view={{ kind: "basicIndustry" }} />
    ) : (
      <BasicTeamCard {...card} />
    );
  // The rest of the walk (the choice, one hire at a time) belongs to the
  // "Build your team" card; the conversation never reaches it.
  return null;
}
