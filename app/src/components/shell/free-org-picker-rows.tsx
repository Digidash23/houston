import type { BillingChoiceOrg } from "@houston/engine-adapter";
import { cn } from "@houston-ai/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** The name an owned org shows: the personal org keeps today's label. */
export function useOrgName(): (org: BillingChoiceOrg) => string {
  const { t } = useTranslation("plan");
  return (org) => (org.personal ? t("choice.picker.personal") : org.name);
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0][0]}${words[1][0]}` : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}

function Glyph({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "hidden size-8 shrink-0 place-items-center rounded-lg bg-chip text-[13px] font-semibold text-chip-text md:grid",
        muted && "opacity-60",
      )}
    >
      {initials(name)}
    </span>
  );
}

export interface OrgRadioProps {
  name: string;
  group: string;
  value: string;
  checked: boolean;
  onSelect: (value: string) => void;
  title: string;
  tag?: ReactNode;
  meta: string;
  trailing?: ReactNode;
}

/**
 * One radio card. The whole row is the hit target (a native radio inside the
 * label), and the selected row wears a 2px ink ring, so the choice reads
 * without hovering.
 */
export function OrgRadio(props: OrgRadioProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl bg-background px-3.5 py-3 outline outline-1 -outline-offset-1 outline-line-input transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus has-[:focus-visible]:ring-offset-2",
        props.checked && "bg-input outline-2 -outline-offset-2 outline-ink",
      )}
    >
      <input
        type="radio"
        className="sr-only"
        name={props.group}
        value={props.value}
        checked={props.checked}
        onChange={() => props.onSelect(props.value)}
      />
      <span
        aria-hidden
        className={cn(
          "grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] border-line-input",
          props.checked && "border-ink",
        )}
      >
        {props.checked && <span className="size-2 rounded-full bg-ink" />}
      </span>
      <Glyph name={props.name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="truncate">{props.title}</span>
          {props.tag}
        </span>
        <span className="mt-0.5 block text-xs text-ink-muted tabular-nums">
          {props.meta}
        </span>
      </span>
      {props.trailing}
    </label>
  );
}

/** The free pick, shown on the payer step as a disabled row. */
export function FreeOrgRow({
  name,
  meta,
  tag,
}: {
  name: string;
  meta: string;
  tag: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-chip px-3.5 py-3">
      <Glyph name={name} muted />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-ink-muted">
          <span className="truncate">{name}</span>
          <span className="rounded-full bg-chip-subtle px-2 py-px text-[11px] font-medium text-ink-muted outline outline-1 -outline-offset-1 outline-line">
            {tag}
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-ink-muted">{meta}</span>
      </span>
    </div>
  );
}

export function MostActiveTag({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full border border-line px-2 py-px text-[11px] font-medium text-ink-muted">
      {label}
    </span>
  );
}

export function PickerFooter({
  start,
  primary,
}: {
  start?: ReactNode;
  primary: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse items-stretch gap-2.5 md:flex-row md:items-center md:gap-3",
        start ? "md:justify-between" : "md:justify-end",
      )}
    >
      {start}
      {primary}
    </div>
  );
}

export function StepLabel({ step }: { step?: 1 | 2 }) {
  const { t } = useTranslation("plan");
  if (!step) return null;
  return (
    <p className="mb-1 text-xs text-ink-muted">
      {t("choice.picker.step", { step })}
    </p>
  );
}
