import type { BillingChoice } from "@houston/engine-adapter";
import {
  FREE_ORG_WEEKLY_MESSAGES,
  formatCutoverDay,
  payerTotals,
  pickerRows,
} from "@houston/sdk";
import { Button } from "@houston-ai/core";
import { ChevronLeft, Info } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  FreeOrgRow,
  MostActiveTag,
  OrgRadio,
  PickerFooter,
  StepLabel,
  useOrgName,
} from "./free-org-picker-rows";

interface StepProps {
  choice: BillingChoice;
  selected: string;
  onSelect: (slug: string) => void;
  /** Set for a payer: the step this is, of two. */
  step?: 1 | 2;
  busy: boolean;
  /** Renders the frame's title element (Dialog or Sheet). */
  title: (text: string) => ReactNode;
}

export function FreeStep(props: StepProps & { onConfirm: () => void }) {
  const { t, i18n } = useTranslation("plan");
  const orgName = useOrgName();
  const rows = pickerRows(props.choice);
  const picked = rows.find((row) => row.org.slug === props.selected)?.org;
  const day = formatCutoverDay(
    props.choice.changeableUntil ?? props.choice.cutoverAt,
    i18n.language,
  );
  return (
    <>
      <div className="pr-7">
        <StepLabel step={props.step} />
        {props.title(t("choice.picker.title"))}
        <p className="mt-2 text-sm leading-relaxed text-hover-text">
          {t("choice.picker.body", { limit: FREE_ORG_WEEKLY_MESSAGES })}
        </p>
      </div>
      <div role="radiogroup" className="flex flex-col gap-2">
        {rows.map(({ org, mostActive }) => (
          <OrgRadio
            key={org.slug}
            group="free-org"
            value={org.slug}
            checked={org.slug === props.selected}
            onSelect={props.onSelect}
            name={orgName(org)}
            title={orgName(org)}
            tag={
              mostActive && (
                <MostActiveTag label={t("choice.picker.mostActive")} />
              )
            }
            meta={t("choice.picker.meta", {
              first: t("choice.picker.members", { count: org.memberCount }),
              second:
                org.messages30d > 0
                  ? t("choice.picker.messages", { count: org.messages30d })
                  : t("choice.picker.noMessages"),
            })}
          />
        ))}
      </div>
      <PickerFooter
        start={
          <span className="text-center text-xs text-ink-muted md:text-left">
            {t("choice.picker.until", { day })}
          </span>
        }
        primary={
          <Button
            size="lg"
            disabled={!picked || props.busy}
            onClick={props.onConfirm}
            className="active:scale-[0.97]"
          >
            {t("choice.picker.keep", { name: picked ? orgName(picked) : "" })}
          </Button>
        }
      />
    </>
  );
}

export function PaidStep(
  props: StepProps & {
    freeSlug: string;
    onBack: () => void;
    onConfirm: () => void;
  },
) {
  const { t, i18n } = useTranslation("plan");
  const orgName = useOrgName();
  const rows = pickerRows(props.choice);
  const free = rows.find((row) => row.org.slug === props.freeSlug)?.org;
  const paid = rows.filter((row) => row.org.slug !== props.freeSlug);
  const picked = paid.find((row) => row.org.slug === props.selected)?.org;
  const totals = picked
    ? payerTotals(props.choice, picked.slug, i18n.language)
    : null;
  return (
    <>
      <div className="pr-7">
        <StepLabel step={2} />
        {props.title(t("choice.payer.title"))}
        <p className="mt-2 text-sm leading-relaxed text-hover-text">
          {t("choice.payer.body")}
        </p>
      </div>
      <div role="radiogroup" className="flex flex-col gap-2">
        {paid.map(({ org }) => {
          const price = payerTotals(props.choice, org.slug, i18n.language);
          return (
            <OrgRadio
              key={org.slug}
              group="paid-org"
              value={org.slug}
              checked={org.slug === props.selected}
              onSelect={props.onSelect}
              name={orgName(org)}
              title={orgName(org)}
              meta={t("choice.picker.meta", {
                first: t("choice.picker.members", { count: org.memberCount }),
                second: t("choice.payer.each", { price: price?.seat }),
              })}
              trailing={
                <span className="shrink-0 text-right text-sm font-medium text-ink tabular-nums">
                  {price?.monthly}
                  <span className="block text-xs font-normal text-ink-muted">
                    {t("choice.payer.perMonth")}
                  </span>
                </span>
              }
            />
          );
        })}
        {free && (
          <FreeOrgRow
            name={orgName(free)}
            tag={t("choice.payer.staysFree")}
            meta={t("choice.payer.yourFree")}
          />
        )}
      </div>
      {totals && (
        <p className="flex gap-2.5 rounded-xl bg-chip px-3.5 py-3 text-[13px] leading-normal text-hover-text">
          <Info aria-hidden className="mt-px size-4 shrink-0" />
          {totals.graceEndsOn
            ? t("choice.payer.grace", {
                today: totals.today,
                date: totals.graceEndsOn,
                monthly: totals.monthly,
              })
            : t("choice.payer.noGrace", { monthly: totals.monthly })}
        </p>
      )}
      <PickerFooter
        start={
          <Button variant="ghost" onClick={props.onBack} disabled={props.busy}>
            <ChevronLeft aria-hidden />
            {t("choice.payer.back")}
          </Button>
        }
        primary={
          <Button
            size="lg"
            disabled={!picked || props.busy}
            onClick={props.onConfirm}
            className="active:scale-[0.97]"
          >
            {t("choice.payer.use", { name: picked ? orgName(picked) : "" })}
          </Button>
        }
      />
    </>
  );
}
