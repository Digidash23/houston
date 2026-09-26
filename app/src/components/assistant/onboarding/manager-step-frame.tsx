import { Button } from "@houston-ai/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CARD_ACTION_CLASS } from "./card-actions";

/**
 * A create-agent step in the AI Manager's step slot: the industry, the role,
 * the naming card, the starter team. The step inside is the create sheet's own
 * component, so it reads exactly as it does there; this is only the sheet's
 * frame brought into the chat: the dialog surface, the wide sheet's body
 * padding, a body that scrolls on its own when the step is taller than the
 * slot, and the actions pinned under it, with the sheet's Back where the
 * answer before the step can still change. Its cap is a share of the chat's own
 * height (`cqh`, against `ManagerChat`'s size container), so the manager's
 * latest line keeps the rest even with the phone keyboard up.
 */
export function ManagerStepFrame({
  id,
  busy = false,
  footer,
  onBack = null,
  error,
  children,
}: {
  /** Stable per step, so a new step enters as new content. */
  id: string;
  /** An answer is saving: the step takes no second one meanwhile. */
  busy?: boolean;
  footer?: ReactNode;
  /** Reopens the answer that led here ("Change answer" on its receipt), or
   *  null when that answer is for good. */
  onBack?: (() => void) | null;
  /** Why the answer did not save, under the step. */
  error?: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation("common");
  return (
    <div
      data-testid="manager-step"
      data-step={id}
      className="ht-shadow-dialog flex max-h-[65cqh] flex-col overflow-clip rounded-2xl border border-line/50 bg-dialog"
    >
      <div
        key={id}
        inert={busy}
        aria-busy={busy || undefined}
        // Never scrolls sideways: a step slides in from 12px off its edge.
        className="create-swap-in min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-6 md:px-8"
      >
        {children}
      </div>
      {error ? (
        <p
          role="alert"
          className="shrink-0 px-5 pb-3 text-sm text-danger-ink md:px-8"
        >
          {error}
        </p>
      ) : null}
      {footer || onBack ? (
        // Back sits above the actions on a phone, leaving the primary nearest
        // the thumb, and at the far left of the row on desktop.
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-5 py-4 md:flex-row md:items-center md:justify-end md:px-8">
          {footer}
          {onBack ? (
            <Button
              type="button"
              variant="ghost"
              className={`${CARD_ACTION_CLASS} md:order-first md:mr-auto`}
              disabled={busy}
              onClick={onBack}
            >
              {t("actions.back")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A step of the conversation's own (the company size, the goal) laid out as
 * the create sheet lays out its questions (`ChoiceStep`'s page size): one left
 * edge, the headline at the sheet's size, an optional hint, then the answer,
 * so every step in the slot reads as one family.
 */
export function ManagerStepBody({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-balance text-2xl font-normal">{title}</h2>
        {hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
