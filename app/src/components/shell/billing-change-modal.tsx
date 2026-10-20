import { layout } from "@houston/design-tokens";
import type { BillingChoice } from "@houston/engine-adapter";
import { type ChoiceModal, choiceModal } from "@houston/sdk";
import { DialogDescription, DialogTitle } from "@houston-ai/core";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useBillingChoice,
  useDismissBillingChoice,
} from "../../hooks/queries/use-billing-choice";
import { useChoiceNow } from "../../hooks/use-choice-now";
import { orgSlugFromWorkspaceId } from "../../lib/space-id";
import { useWorkspaceStore } from "../../stores/workspaces";
import { useNoticeBody } from "./billing-change-copy";
import { PickerBody } from "./free-org-picker";
import { PlanAnnouncementCta } from "./plan-announcement-cta";
import {
  PlanBriefingFrame,
  PlanBriefingQuietButton,
} from "./plan-briefing-frame";

type Shown = Extract<ChoiceModal, { open: true }>;

/**
 * The pricing-change announcement, shown when the app opens. Cloud only.
 * Every rule about whether it shows and what closing it does lives in the
 * SDK's {@link choiceModal}; this holds the session's "Maybe later" and
 * renders. An owner who has to pick moves from the intro to the picker in
 * the same frame.
 */
export function BillingChangeModal({
  otherDialogOpen,
}: {
  otherDialogOpen: boolean;
}) {
  const { data: choice } = useBillingChoice();
  const current = useWorkspaceStore((s) => s.current);
  const { t, i18n } = useTranslation("plan");
  const now = useChoiceNow(choice);
  const dismiss = useDismissBillingChoice();
  const [later, setLater] = useState(false);
  const [picking, setPicking] = useState(false);
  const modal = choiceModal(choice, {
    now,
    activeOrgSlug: current ? orgSlugFromWorkspaceId(current.id) : null,
    locale: i18n.language,
    laterThisSession: later,
    otherDialogOpen,
  });
  // The last notice shown keeps the frame's contents through its exit.
  const shown = useRef<Shown | null>(null);
  if (modal.open) shown.current = modal;
  const last = shown.current;
  if (!choice || !last) return null;
  const close = () => {
    if (last.close === "session") setLater(true);
    else dismiss.mutate();
  };
  return (
    <PlanBriefingFrame
      open={modal.open}
      onDismiss={close}
      closeLabel={
        last.close === "session" ? t("maybeLater") : t("choice.notice.close")
      }
      width={layout["choice-dialog-width"]}
      described={!picking}
      testId="billing-change-modal"
    >
      {picking ? (
        <PickerBody choice={choice} onDone={close} />
      ) : (
        <Intro
          shown={last}
          choice={choice}
          onPick={() => setPicking(true)}
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
  shown: Shown;
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
