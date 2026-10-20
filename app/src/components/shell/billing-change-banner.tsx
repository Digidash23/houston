import type { BillingChoice } from "@houston/engine-adapter";
import { canChangeChoice, choiceNotice } from "@houston/sdk";
import { Button, cn } from "@houston-ai/core";
import { CalendarDays, Check, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useBillingChoice,
  useChoiceNow,
  useDismissBillingChoice,
} from "../../hooks/queries/use-billing-choice";
import { orgSlugFromWorkspaceId } from "../../lib/space-id";
import { useWorkspaceStore } from "../../stores/workspaces";
import { type Shown, useNoticeText } from "./billing-change-copy";
import { FreeOrgPicker } from "./free-org-picker";

/**
 * The pricing-change announcement: a slim bar at the top of the main screen
 * card (never over the sidebar), cloud only. Every rule about which variant
 * shows lives in the SDK's {@link choiceNotice}; this renders it. The X hides
 * it on every device. Phone wraps the action onto its own row.
 */
export function BillingChangeBanner() {
  const { data: choice } = useBillingChoice();
  const current = useWorkspaceStore((s) => s.current);
  const { i18n } = useTranslation("plan");
  const now = useChoiceNow(choice);
  const notice = choiceNotice(choice, {
    now,
    activeOrgSlug: current ? orgSlugFromWorkspaceId(current.id) : null,
    locale: i18n.language,
  });
  if (!choice || notice.kind === "hidden") return null;
  return (
    <Bar
      notice={notice}
      choice={choice}
      changeable={canChangeChoice(choice, now)}
    />
  );
}

function Bar({
  notice,
  choice,
  changeable,
}: {
  notice: Shown;
  choice: BillingChoice;
  changeable: boolean;
}) {
  const { t } = useTranslation("plan");
  const dismiss = useDismissBillingChoice();
  const [picking, setPicking] = useState(false);
  const bar = useRef<HTMLElement>(null);
  // Radix runs this once the frame has closed, after a save has already
  // swapped Choose for Change, so the bar's first button is the right one.
  const returnFocus = () =>
    bar.current?.querySelector<HTMLButtonElement>("button")?.focus();
  const text = useNoticeText(notice, choice);
  const done = notice.kind === "picked";
  const action =
    notice.kind === "pick" ? (
      <Button
        size="sm"
        onClick={() => setPicking(true)}
        className="col-start-2 row-start-2 justify-self-start active:scale-[0.97] md:shrink-0"
      >
        {t("choice.notice.choose")}
      </Button>
    ) : done && changeable ? (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setPicking(true)}
        className="col-start-3 row-start-1 h-7 px-2.5 text-[13px] underline decoration-line-input underline-offset-[3px] md:shrink-0"
      >
        {t("choice.picked.change")}
      </Button>
    ) : null;
  return (
    <>
      <section
        ref={bar}
        aria-label={t("choice.notice.label")}
        data-testid="billing-change-banner"
        className={cn(
          "grid shrink-0 items-start gap-x-2.5 gap-y-2 border-b border-line text-[13px] leading-normal motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200 md:flex md:items-center md:gap-3",
          done
            ? "grid-cols-[1rem_1fr_auto_2rem] items-center bg-background py-2 pr-1.5 pl-3.5 text-hover-text md:py-1 md:pr-2 md:pl-4"
            : "grid-cols-[1.5rem_1fr_2rem] bg-input pt-2.5 pr-1.5 pb-3 pl-3.5 md:py-2 md:pr-2 md:pl-4",
        )}
      >
        {done ? (
          <Check aria-hidden className="size-4 shrink-0 text-success-ink" />
        ) : (
          <span
            aria-hidden
            className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-sm bg-highlight text-highlight-text md:mt-0"
          >
            <CalendarDays className="size-3.5" />
          </span>
        )}
        <p className={cn("min-w-0 flex-1", !done && "pt-0.5 md:pt-0")}>
          <span className={done ? "font-medium text-ink" : "text-ink"}>
            {text.lead}
          </span>{" "}
          <span className="text-hover-text">{text.rest}</span>
        </p>
        {action}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("choice.notice.dismiss")}
          onClick={() => dismiss.mutate()}
          className={cn(
            "row-start-1 text-hover-text md:shrink-0",
            done ? "col-start-4" : "col-start-3",
          )}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </section>
      {(notice.kind === "pick" || done) && (
        <FreeOrgPicker
          choice={choice}
          open={picking}
          onOpenChange={setPicking}
          returnFocus={returnFocus}
        />
      )}
    </>
  );
}
