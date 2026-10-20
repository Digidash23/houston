import type { BillingChoice, BillingChoicePick } from "@houston/engine-adapter";
import { choosesPaidOrg, defaultFreeOrg, defaultPaidOrg } from "@houston/sdk";
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
  const [step, setStep] = useState<"free" | "paid">("free");
  const [free, setFree] = useState(() => defaultFreeOrg(choice) ?? "");
  const [paid, setPaid] = useState<string | null>(null);
  const Title = mobile ? SheetTitle : DialogTitle;
  const title = (text: string) => <Title className={TITLE_CLASS}>{text}</Title>;

  const submit = (pick: BillingChoicePick) =>
    save.mutate(pick, {
      onSuccess: (outcome) => {
        if (outcome.kind === "saved") onDone();
      },
    });

  if (step === "paid")
    return (
      <PaidStep
        choice={choice}
        freeSlug={free}
        selected={paid ?? ""}
        onSelect={setPaid}
        busy={save.isPending}
        title={title}
        onBack={() => setStep("free")}
        onConfirm={() =>
          paid && submit({ freeOrgSlug: free, paidOrgSlug: paid })
        }
      />
    );
  return (
    <FreeStep
      choice={choice}
      selected={free}
      onSelect={setFree}
      step={payer ? 1 : undefined}
      busy={save.isPending}
      title={title}
      onConfirm={() => {
        if (!payer) return submit({ freeOrgSlug: free });
        setPaid((current) =>
          current && current !== free ? current : defaultPaidOrg(choice, free),
        );
        setStep("paid");
      }}
    />
  );
}

/** A centered dialog on desktop, a bottom sheet on phones (a structural fork). */
export function FreeOrgPicker({
  choice,
  open,
  onOpenChange,
}: {
  choice: BillingChoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
          className="max-h-[90dvh] gap-4 overflow-y-auto rounded-t-2xl border-line/50 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
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
        className="gap-5 sm:max-w-[30rem]"
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}
