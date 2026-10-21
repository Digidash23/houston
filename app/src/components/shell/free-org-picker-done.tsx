import type { ChoiceDone } from "@houston/sdk";
import { DialogDescription, DialogTitle } from "@houston-ai/core";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOrgName } from "./free-org-picker-rows";
import { PlanBriefingCta } from "./plan-briefing-cta";

/**
 * The picker's last step once a pick is stored, in the same frame: which org
 * stays free and what happens to the rest. The SDK decides when it shows
 * ({@link ChoiceDone}); Done, the X, Escape and a click outside all close it.
 */
export function DoneStep({
  done,
  onClose,
}: {
  done: ChoiceDone;
  onClose: () => void;
}) {
  const { t } = useTranslation("plan");
  const orgName = useOrgName();
  const body =
    done.kind === "payer"
      ? t("choice.done.payer", { paid: orgName(done.paid), date: done.date })
      : done.kind === "others_need_plan"
        ? t("choice.done.othersNeedPlan", { date: done.date })
        : null;
  return (
    <>
      <div className="space-y-4 pb-8 pt-4 md:pt-2">
        <span
          aria-hidden
          className="plan-briefing-pop grid size-10 place-items-center rounded-full bg-success/15 text-success-ink"
        >
          <Check className="size-5" />
        </span>
        <DialogTitle className="pr-8 text-balance text-2xl font-medium leading-tight tracking-tight text-ink md:text-3xl">
          {t("choice.done.title", { name: orgName(done.free) })}
        </DialogTitle>
        <DialogDescription className="max-w-prose space-y-2 text-base leading-relaxed text-ink">
          {body && <span className="block">{body}</span>}
          <span className="block text-sm text-ink-muted">
            {t("choice.done.change")}
          </span>
        </DialogDescription>
      </div>
      {/* The phone sheet seats the action at the bottom, under the thumb. */}
      <div className="mt-auto flex flex-col md:mt-0">
        <PlanBriefingCta label={t("choice.done.close")} onClick={onClose} />
      </div>
    </>
  );
}
