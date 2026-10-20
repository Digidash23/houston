import { layout } from "@houston/design-tokens";
import type { BillingChoice, BillingChoicePick } from "@houston/engine-adapter";
import {
  choosesPaidOrg,
  defaultFreeOrg,
  defaultPaidOrg,
  type PickerState,
  reconcilePick,
} from "@houston/sdk";
import { DialogTitle } from "@houston-ai/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetBillingChoice } from "../../hooks/queries/use-billing-choice";
import { FreeStep, PaidStep } from "./free-org-picker-steps";
import { PlanBriefingFrame } from "./plan-briefing-frame";

const TITLE_CLASS =
  "text-2xl font-medium leading-tight tracking-tight text-balance text-ink";

/**
 * The steps, mounted fresh on every open so each one starts on the stored
 * pick (else the busiest org). A Plus or comp payer gets a second step in the
 * same frame for the org their subscription pays for. Renders inside a
 * {@link PlanBriefingFrame}: the Settings entry's own, or the pricing-change
 * modal's after its intro.
 */
export function PickerBody({
  choice,
  onDone,
}: {
  choice: BillingChoice;
  onDone: () => void;
}) {
  const save = useSetBillingChoice();
  const payer = choosesPaidOrg(choice);
  const [state, setState] = useState<PickerState>(() => ({
    step: "free",
    free: defaultFreeOrg(choice),
    paid: null,
  }));
  // Valid against the latest choice, which a refusal's refetch may change.
  const { step, free, paid } = reconcilePick(choice, state);
  const update = (patch: Partial<PickerState>) =>
    setState({ step, free, paid, ...patch });
  const title = (text: string, id: string) => (
    // The id rides an inner span: Radix names the frame by the title's own id.
    <DialogTitle className={TITLE_CLASS}>
      <span id={id}>{text}</span>
    </DialogTitle>
  );

  const submit = (pick: BillingChoicePick) =>
    save.mutate(pick, {
      onSuccess: (outcome) => {
        if (outcome.kind === "saved") onDone();
        if (outcome.kind === "not_payer") update({ step: "free", paid: null });
      },
    });

  if (step === "paid")
    return (
      <div className="flex flex-col gap-5">
        <PaidStep
          choice={choice}
          freeSlug={free ?? ""}
          selected={paid ?? ""}
          onSelect={(slug) => update({ paid: slug })}
          busy={save.isPending}
          title={title}
          onBack={() => update({ step: "free" })}
          onConfirm={() =>
            free && paid && submit({ freeOrgSlug: free, paidOrgSlug: paid })
          }
        />
      </div>
    );
  return (
    <div className="flex flex-col gap-5">
      <FreeStep
        choice={choice}
        selected={free ?? ""}
        onSelect={(slug) => update({ free: slug })}
        step={payer ? 1 : undefined}
        busy={save.isPending}
        title={title}
        onConfirm={() => {
          if (!free) return;
          if (!payer) return submit({ freeOrgSlug: free });
          update({
            step: "paid",
            paid: paid && paid !== free ? paid : defaultPaidOrg(choice, free),
          });
        }}
      />
    </div>
  );
}

/** The picker on its own, opened from Settings > Billing. */
export function FreeOrgPicker({
  choice,
  open,
  onOpenChange,
  returnFocus,
}: {
  choice: BillingChoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus lands on close: the frame has no trigger of its own. */
  returnFocus: () => void;
}) {
  const { t } = useTranslation("plan");
  return (
    <PlanBriefingFrame
      open={open}
      onDismiss={() => onOpenChange(false)}
      closeLabel={t("choice.picker.close")}
      width={layout["choice-dialog-width"]}
      described={false}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        returnFocus();
      }}
      testId="free-org-picker"
    >
      <PickerBody choice={choice} onDone={() => onOpenChange(false)} />
    </PlanBriefingFrame>
  );
}
