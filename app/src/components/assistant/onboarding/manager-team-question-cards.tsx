import { Button, Spinner } from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import { finishPressable } from "../../onboarding/team/team-roster-model";
import type { TeamView } from "../../onboarding/team/team-view-model";
import {
  CARD_ACTION_CLASS,
  CARD_PRIMARY_ACTION_CLASS,
  CardActions,
} from "./card-actions";
import { ManagerRosterList } from "./manager-roster-list";
import type { TeamPromptProps } from "./manager-team-prompt";
import type { ManagerTeam } from "./use-manager-team";
import type { ScriptCopy } from "./use-script-copy";

/** What every team card is handed. */
export interface TeamCardProps {
  team: ManagerTeam;
  copy: ScriptCopy;
  view: TeamView;
  onAnswer: TeamPromptProps["onAnswer"];
  onBack: TeamPromptProps["onBack"];
}

const DONE = { question: "teamDone", value: "done" } as const;

/**
 * A run resumed with AI Employees already hired, below the manager's count
 * of them: the team so far (each hire's progress, and Try again on one that
 * failed), then "That's my team", which holds a spinner until every hire has
 * landed, and "Hire one more", which opens the starter team.
 */
export function NextCard({ team, view, onAnswer }: TeamCardProps) {
  const { t } = useTranslation("assistant");
  const { finishing } = team;
  return (
    <div data-testid="manager-team-next" className="flex w-full flex-col gap-3">
      <ManagerRosterList rows={team.rows} />
      <div className="flex w-full md:justify-end">
        <CardActions>
          <Button
            type="button"
            className={CARD_PRIMARY_ACTION_CLASS}
            disabled={finishing || !finishPressable(team.finishState)}
            aria-busy={finishing || undefined}
            onClick={() => team.finish(DONE)}
          >
            {finishing ? <Spinner className="size-4" /> : null}
            {t("onboarding.choices.done")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={CARD_ACTION_CLASS}
            disabled={finishing}
            onClick={() =>
              onAnswer({ question: "teamNext", value: "another" }, view)
            }
          >
            {t("onboarding.choices.another")}
          </Button>
        </CardActions>
      </div>
    </div>
  );
}
