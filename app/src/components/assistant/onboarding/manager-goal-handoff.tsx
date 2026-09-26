import { Button, Spinner } from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import type { HandoffAbout } from "../../../lib/manager-onboarding/handoff-prompt";
import type { ManagerReach } from "../../../lib/manager-onboarding/script";
import {
  CARD_ACTION_CLASS,
  CARD_PRIMARY_ACTION_CLASS,
  CardActions,
} from "./card-actions";
import { useGoalHandoff } from "./use-goal-handoff";

/**
 * The closing's two answers, sitting in the step slot under the manager's
 * offer to start on the person's goal: "Yes, let's do it" leads, "Not now"
 * beside it. Once one is pressed, it holds a spinner while the conversation
 * saves and neither takes a second press.
 */
export function ManagerGoalHandoff({
  goal,
  about,
  reach,
  finish,
}: {
  goal: string;
  about: HandoffAbout;
  reach: ManagerReach;
  finish: (then?: () => void) => void;
}) {
  const { t } = useTranslation("assistant");
  const { choice, accept, decline } = useGoalHandoff({
    goal,
    about,
    reach,
    finish,
  });
  const busy = choice !== null;
  return (
    <div data-testid="manager-handoff" className="flex w-full md:justify-end">
      <CardActions>
        <Button
          type="button"
          className={CARD_PRIMARY_ACTION_CLASS}
          disabled={busy}
          aria-busy={choice === "accepted" || undefined}
          onClick={accept}
        >
          {choice === "accepted" ? <Spinner className="size-4" /> : null}
          {t("onboarding.handoff.yes")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={CARD_ACTION_CLASS}
          disabled={busy}
          aria-busy={choice === "declined" || undefined}
          onClick={decline}
        >
          {choice === "declined" ? <Spinner className="size-4" /> : null}
          {t("onboarding.handoff.notNow")}
        </Button>
      </CardActions>
    </div>
  );
}
