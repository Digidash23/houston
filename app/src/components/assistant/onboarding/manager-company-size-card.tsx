import { Button } from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import {
  isOnboardingCompanySize,
  ONBOARDING_COMPANY_SIZE_IDS,
  type OnboardingCompanySize,
} from "../../../lib/onboarding-survey";
import { ChoiceChips } from "../../shell/choice-chips";
import { useChipGrid } from "../../shell/use-choice-keyboard";
import { CARD_ACTION_CLASS, CardActions } from "./card-actions";
import { ManagerStepBody, ManagerStepFrame } from "./manager-step-frame";

/**
 * "How big is your company?", answered with one tap on the create sheet's own
 * chips, the buckets smallest first, so the whole range reads at a glance.
 * The answer already held (one being changed) is the chip picked; the arrows
 * walk the chips as they do on the sheet. Back reopens the answer before it,
 * and "Not now" puts the questions off where they can be.
 */
export function ManagerCompanySizeCard({
  title,
  held,
  busy,
  error,
  onAnswer,
  onDecline,
  onBack = null,
}: {
  title: string;
  /** The size already given, when it is being changed. */
  held: OnboardingCompanySize | null;
  busy: boolean;
  error: string | null;
  onAnswer: (size: OnboardingCompanySize) => void;
  /** "Not now", where the questions can be put off. */
  onDecline?: () => void;
  onBack?: (() => void) | null;
}) {
  const { t } = useTranslation(["assistant", "setup"]);
  const grid = useChipGrid();
  const options = ONBOARDING_COMPANY_SIZE_IDS.map((id) => ({
    id,
    label: t(`assistant:onboarding.companySize.${id}`),
  }));
  return (
    <ManagerStepFrame
      id="survey-companySize"
      busy={busy}
      error={error}
      onBack={onBack}
      footer={
        onDecline ? (
          <CardActions>
            <Button
              type="button"
              variant="ghost"
              className={CARD_ACTION_CLASS}
              disabled={busy}
              onClick={onDecline}
            >
              {t("setup:onboardingSurvey.completion.notNow")}
            </Button>
          </CardActions>
        ) : undefined
      }
    >
      <ManagerStepBody title={title}>
        <div ref={grid.ref} role="radiogroup" aria-label={title}>
          <ChoiceChips
            options={options}
            selectedId={held}
            rovingId={held ?? options[0].id}
            onKeyDown={grid.onKeyDown}
            onSelect={(id) => {
              if (isOnboardingCompanySize(id)) onAnswer(id);
            }}
          />
        </div>
      </ManagerStepBody>
    </ManagerStepFrame>
  );
}
