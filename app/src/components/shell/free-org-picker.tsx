import type { BillingChoice, BillingChoicePick } from "@houston/engine-adapter";
import {
  choosesPaidOrg,
  defaultFreeOrg,
  defaultPaidOrg,
  type PickerState,
  reconcilePick,
} from "@houston/sdk";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetTitle,
  useIsMobile,
} from "@houston-ai/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetBillingChoice } from "../../hooks/queries/use-billing-choice";
import { FreeStep, PaidStep } from "./free-org-picker-steps";

const TITLE_CLASS = "text-xl font-medium leading-snug text-balance text-ink";

/**
 * The steps, mounted fresh on every open so each one starts on the stored
 * pick (else the busiest org). A Plus or comp payer gets a second step in the
 * same frame for the org their subscription pays for.
 */
function PickerBody({
  choice,
  mobile,
  onDone,
}: {
  choice: BillingChoice;
  mobile: boolean;
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
  const Title = mobile ? SheetTitle : DialogTitle;
  const title = (text: string, id: string) => (
    // The id rides an inner span: Radix names the frame by the title's own id.
    <Title className={TITLE_CLASS}>
      <span id={id}>{text}</span>
    </Title>
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
    );
  return (
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
  );
}

/** A centered dialog on desktop, a bottom sheet on phones (a structural fork). */
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
  const mobile = useIsMobile();
  const body = (
    <>
      <DialogCloseButton
        label={t("choice.picker.close")}
        className="absolute top-3.5 right-3.5"
      />
      <PickerBody
        choice={choice}
        mobile={mobile}
        onDone={() => onOpenChange(false)}
      />
    </>
  );
  const closeFocus = (event: Event) => {
    event.preventDefault();
    returnFocus();
  };
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
          onCloseAutoFocus={closeFocus}
          className="max-h-[90dvh] gap-4 overflow-y-auto rounded-t-2xl border-line/50 p-5 pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))+1.25rem)]"
        >
          {body}
        </SheetContent>
      </Sheet>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={closeFocus}
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-[30rem]"
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}
