import { layout } from "@houston/design-tokens";
import type { PlanSummary } from "@houston/engine-adapter";
import {
  createPlanAnnouncementActions,
  planAnnouncementView,
} from "@houston/sdk";
import { DialogDescription, DialogTitle } from "@houston-ai/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDismissPlanAnnouncement } from "../../hooks/queries/use-plan";
import { usePlusCheckout } from "../../hooks/queries/use-plus-checkout";
import { useUIStore } from "../../stores/ui";
import { PlanAnnouncementCta } from "./plan-announcement-cta";
import { PlanAnnouncementGift } from "./plan-announcement-gift";
import { PlanAnnouncementPlans } from "./plan-announcement-plans";
import { PlanBriefingQuietButton } from "./plan-briefing-cta";
import { PlanBriefingFrame } from "./plan-briefing-frame";

/**
 * The one-time launch announcement. `onDismiss` tells the shell it is gone
 * the moment the person closes it, before the server confirms, so the
 * dialogs waiting behind it (the pricing change) can follow.
 */
export function PlanAnnouncementDialog({
  plan,
  open,
  onDismiss,
}: {
  plan: PlanSummary;
  open: boolean;
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation("plan");
  const dismiss = useDismissPlanAnnouncement();
  const checkout = usePlusCheckout();
  const openSettings = useUIStore((s) => s.openSettings);
  const view = planAnnouncementView(plan, i18n.language);

  const [actions] = useState(() =>
    createPlanAnnouncementActions({
      dismiss: () => {
        onDismiss();
        dismiss.mutate();
      },
      checkout: () => checkout.start(),
      openPlans: () => openSettings("plan"),
    }),
  );

  return (
    <PlanBriefingFrame
      open={open}
      onDismiss={actions.close}
      closeLabel={t("maybeLater")}
      width={layout["announcement-dialog-width"]}
    >
      <div className="plan-briefing-rise plan-briefing-stage-2 space-y-4 pb-8 pt-4 md:pb-10 md:pt-6">
        <DialogTitle className="pr-8 text-balance text-3xl font-medium leading-tight tracking-tight md:text-4xl">
          {view.starts
            ? t("announcementBetaTitle", { date: view.starts })
            : t("announcementBetaTitleNow")}
        </DialogTitle>
        <DialogDescription className="max-w-prose text-base leading-relaxed text-ink-muted">
          {t("announcementThanks")}
        </DialogDescription>
      </div>
      <PlanAnnouncementPlans view={view} />
      {view.offer ? (
        <PlanAnnouncementGift offer={view.offer} price={view.plus.current}>
          <PlanAnnouncementCta
            label={t("announcementCta", { amount: view.offer.amount })}
            pending={checkout.outstanding}
            fallbackUrl={checkout.fallbackUrl}
            onClick={() => actions.primary(view.action)}
          />
        </PlanAnnouncementGift>
      ) : (
        <div className="plan-briefing-rise plan-briefing-stage-4 mt-6">
          <PlanAnnouncementCta
            label={t("seePlans")}
            pending={false}
            fallbackUrl={null}
            onClick={() => actions.primary(view.action)}
          />
        </div>
      )}
      <PlanBriefingQuietButton
        onClick={actions.close}
        className="plan-briefing-rise plan-briefing-stage-6"
      >
        {t("maybeLater")}
      </PlanBriefingQuietButton>
    </PlanBriefingFrame>
  );
}
