import { layout } from "@houston/design-tokens";
import type { BillingChoice } from "@houston/engine-adapter";
import {
  CLOSED_CHOICE_FRAME,
  choiceModal,
  closeChoiceFrame,
  finishPicking,
  nextChoiceModalFrame,
  type ShownChoiceModal,
  startPicking,
} from "@houston/sdk";
import { DialogDescription, DialogTitle } from "@houston-ai/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useBillingChoice,
  useDismissBillingChoice,
} from "../../hooks/queries/use-billing-choice";
import { useChoiceNow } from "../../hooks/use-choice-now";
import { useNoticeBody } from "./billing-change-copy";
import { PickerBody } from "./free-org-picker";
import { DoneStep } from "./free-org-picker-done";
import { PlanAnnouncementCta } from "./plan-announcement-cta";
import {
  PlanBriefingFrame,
  PlanBriefingQuietButton,
} from "./plan-briefing-frame";

/**
 * The pricing-change announcement, shown when the app opens. Cloud only.
 * Every rule about whether it shows, what closing it does and when the picker
 * replaces the intro lives in the SDK ({@link choiceModal},
 * {@link nextChoiceModalFrame}); this holds the session's close and the frame,
 * and renders. An owner who has to pick moves from the intro to the picker,
 * then to the success step, in the same frame.
 */
export function BillingChangeModal({
  otherDialogOpen,
}: {
  otherDialogOpen: boolean;
}) {
  const { data: choice } = useBillingChoice();
  const { t, i18n } = useTranslation("plan");
  const now = useChoiceNow(choice);
  const dismiss = useDismissBillingChoice();
  const [closed, setClosed] = useState(false);
  const [stored, setFrame] = useState(CLOSED_CHOICE_FRAME);
  const modal = choiceModal(choice, {
    now,
    locale: i18n.language,
    closedThisSession: closed,
    otherDialogOpen,
  });
  // Derived from the last render's frame; React re-renders before painting.
  const frame = nextChoiceModalFrame(stored, modal);
  if (frame !== stored) setFrame(frame);
  const { shown, phase } = frame;
  if (!choice || !shown) return null;
  const close = () => {
    setClosed(true);
    setFrame(closeChoiceFrame);
    if (shown.close === "everywhere") dismiss.mutate();
  };
  return (
    <PlanBriefingFrame
      open={frame.open}
      onDismiss={close}
      closeLabel={
        shown.close === "session" && phase.step !== "done"
          ? t("maybeLater")
          : t("choice.notice.close")
      }
      width={layout["choice-dialog-width"]}
      described={phase.step !== "picking"}
      testId="billing-change-modal"
    >
      {phase.step === "done" ? (
        <DoneStep done={phase.done} onClose={close} />
      ) : phase.step === "picking" ? (
        <PickerBody
          choice={choice}
          onAnswer={(outcome) =>
            setFrame((current) =>
              finishPicking(current, outcome, i18n.language),
            )
          }
        />
      ) : (
        <Intro
          shown={shown}
          choice={choice}
          onPick={() => setFrame(startPicking)}
          onClose={close}
        />
      )}
    </PlanBriefingFrame>
  );
}

function Intro({
  shown,
  choice,
  onPick,
  onClose,
}: {
  shown: ShownChoiceModal;
  choice: BillingChoice;
  onPick: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("plan");
  const body = useNoticeBody(shown.notice, choice);
  const pick = shown.notice.kind === "pick";
  return (
    <>
      <div className="plan-briefing-rise plan-briefing-stage-2 space-y-4 pb-8 pt-4 md:pt-6">
        <DialogTitle className="pr-8 text-balance text-3xl font-medium leading-tight tracking-tight md:text-4xl">
          {t("choice.notice.title")}
        </DialogTitle>
        <DialogDescription className="max-w-prose text-base leading-relaxed text-ink-muted">
          {body}
        </DialogDescription>
      </div>
      {/* The phone sheet seats the actions at the bottom, under the thumb. */}
      <div className="plan-briefing-rise plan-briefing-stage-4 mt-auto flex flex-col md:mt-0">
        <PlanAnnouncementCta
          label={pick ? t("choice.notice.choose") : t("choice.notice.gotIt")}
          pending={false}
          fallbackUrl={null}
          onClick={pick ? onPick : onClose}
        />
        {pick && (
          <PlanBriefingQuietButton onClick={onClose}>
            {t("maybeLater")}
          </PlanBriefingQuietButton>
        )}
      </div>
    </>
  );
}
