import { layout } from "@houston/design-tokens";
import type {
  BillingChoice,
  BillingChoicePick,
  BillingChoiceSave,
} from "@houston/engine-adapter";
import {
  type ChoicePickerFrame,
  choicePickerSaved,
  choosesPaidOrg,
  closeChoicePicker,
  defaultFreeOrg,
  defaultPaidOrg,
  type PickerState,
  reconcilePick,
} from "@houston/sdk";
import { DialogTitle } from "@houston-ai/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetBillingChoice } from "../../hooks/queries/use-billing-choice";
import { DoneStep } from "./free-org-picker-done";
import { FreeStep, PaidStep } from "./free-org-picker-steps";
import { PlanBriefingFrame } from "./plan-briefing-frame";
import { BriefingStep } from "./plan-briefing-swap";

const TITLE_CLASS =
  "mb-5 pr-8 text-2xl font-semibold leading-tight tracking-tight text-balance text-ink";

/**
 * The steps, mounted fresh on every open so each one starts on the stored
 * pick (else the busiest org). A Plus or comp payer gets a second step in the
 * same frame for the org their subscription pays for. Renders inside a
 * {@link PlanBriefingFrame}: the Settings entry's own, or the pricing-change
 * modal's after its intro. Every save's answer goes to `onAnswer`, whose SDK
 * frame moves a stored pick to the success step.
 */
export function PickerBody({
  choice,
  onAnswer,
}: {
  choice: BillingChoice;
  onAnswer: (outcome: BillingChoiceSave) => void;
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
        if (outcome.kind === "not_payer") update({ step: "free", paid: null });
        onAnswer(outcome);
      },
    });

  return (
    <BriefingStep step={step}>
      {step === "paid" ? (
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
      ) : (
        <FreeStep
          choice={choice}
          selected={free ?? ""}
          onSelect={(slug) => update({ free: slug })}
          payer={payer}
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
      )}
    </BriefingStep>
  );
}

/**
 * The picker on its own, opened from Settings > Billing, then its success
 * step until the person closes it. The row that opens it holds the frame.
 */
export function FreeOrgPicker({
  choice,
  frame,
  setFrame,
  returnFocus,
}: {
  choice: BillingChoice;
  frame: ChoicePickerFrame;
  setFrame: (next: (frame: ChoicePickerFrame) => ChoicePickerFrame) => void;
  /** Where focus lands on close: the frame has no trigger of its own. */
  returnFocus: () => void;
}) {
  const { t } = useTranslation("plan");
  const close = () => setFrame(closeChoicePicker);
  return (
    <PlanBriefingFrame
      open={frame.open}
      onDismiss={close}
      closeLabel={t("choice.picker.close")}
      width={layout["choice-dialog-width"]}
      described={frame.done !== null}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        returnFocus();
      }}
      testId="free-org-picker"
    >
      <BriefingStep step={frame.done ? "done" : "picking"}>
        {frame.done ? (
          <DoneStep done={frame.done} onClose={close} />
        ) : (
          <PickerBody
            choice={choice}
            onAnswer={(outcome) =>
              setFrame((current) => choicePickerSaved(current, outcome))
            }
          />
        )}
      </BriefingStep>
    </PlanBriefingFrame>
  );
}
