import { Button, Spinner } from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import { TeamBasicView } from "../../onboarding/team/team-basic-view";
import {
  CARD_ACTION_CLASS,
  CARD_PRIMARY_ACTION_CLASS,
  CardActions,
} from "./card-actions";
import { ManagerStepFrame } from "./manager-step-frame";
import type { TeamCardProps } from "./manager-team-question-cards";

const BASIC_FORM_ID = "manager-team-basic";

/**
 * The starter team, as the "Build your team" card welcomes it: an employee
 * card per AI Employee with the name, job, industry and color open to change,
 * Remove to let one go, and "Hire one more" in the footer, always in view,
 * to add a card. "Hire my team"
 * hires them all (each created behind the person) and holds a spinner until
 * every hire has landed; then the manager closes. Back
 * returns to the answer before it (the industry, when it was asked here).
 */
export function BasicTeamCard({ team, onBack }: TeamCardProps) {
  const { t, i18n } = useTranslation("setup");
  const { basic, roster, finishing } = team;

  return (
    <ManagerStepFrame
      id="team-basic"
      onBack={finishing ? null : onBack}
      footer={
        <CardActions>
          <Button
            type="submit"
            form={BASIC_FORM_ID}
            className={CARD_PRIMARY_ACTION_CLASS}
            disabled={finishing}
            aria-busy={finishing || undefined}
          >
            {finishing ? <Spinner className="size-4" /> : null}
            {t("team.basic.submit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={CARD_ACTION_CLASS}
            disabled={finishing}
            onClick={basic.add}
          >
            {t("team.basic.add")}
          </Button>
        </CardActions>
      }
    >
      <TeamBasicView
        team={basic}
        takenNames={roster.takenNames}
        formId={BASIC_FORM_ID}
        onSubmit={() => {
          const outcome = basic.submit();
          // "idle": everyone already joined (a Retry landed the last one), so
          // the press only finishes the team.
          if (outcome.kind !== "invalid") {
            const names = new Intl.ListFormat(i18n.language, {
              type: "conjunction",
            }).format(basic.rows.map((row) => row.name.trim()));
            team.finish({ question: "teamBasic", value: names });
          }
          return outcome;
        }}
        onEdit={roster.edit}
        onRetry={roster.retry}
        onRemove={roster.remove}
      />
    </ManagerStepFrame>
  );
}
