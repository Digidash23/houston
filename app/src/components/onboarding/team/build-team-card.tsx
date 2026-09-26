import { Spinner } from "@houston-ai/core";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { TeamCardFlow } from "./team-card-flow";
import { useSurveyRoleStart } from "./use-survey-role-start";

/**
 * "Build your team" for a workspace just created: its first AI Employees,
 * either hired one at a time through the in-app hire (industry, job, name) or
 * as a ready-made team of three. The industry the person gave in the survey
 * is already answered on both paths. The card is content alone: the dialog
 * that created the workspace owns the frame (and the way out) around it.
 *
 * Hires land in `workspaceId` with their first day pending: this card builds
 * the team and hands over with `onDone`; nobody starts working from here.
 */
export function BuildTeamCard({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: () => void;
}): JSX.Element {
  const { t } = useTranslation("common");
  const survey = useSurveyRoleStart();
  // The industry question takes its opening answer once, when it mounts, so
  // the flow waits for the survey record rather than opening blank on it.
  if (survey.loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner
          className="size-5 text-ink-muted"
          aria-label={t("actions.loading")}
        />
      </div>
    );
  }
  return (
    <TeamCardFlow
      workspaceId={workspaceId}
      start={survey.start}
      onDone={onDone}
    />
  );
}
