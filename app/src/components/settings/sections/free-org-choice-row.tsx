import {
  CLOSED_CHOICE_PICKER,
  canChangeChoice,
  formatCutoverDate,
  formatCutoverDay,
  openChoicePicker,
} from "@houston/sdk";
import { Button, Card } from "@houston-ai/core";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBillingChoice } from "../../../hooks/queries/use-billing-choice";
import { useChoiceNow } from "../../../hooks/use-choice-now";
import { FreeOrgPicker } from "../../shell/free-org-picker";
import { useOrgName } from "../../shell/free-org-picker-rows";

/**
 * The way back into the free-org picker while a pick is still open, so a
 * dismissed announcement never strands an owner who still has to choose.
 */
export function FreeOrgChoiceRow() {
  const { t, i18n } = useTranslation("plan");
  const { data: choice } = useBillingChoice();
  const orgName = useOrgName();
  const [frame, setFrame] = useState(CLOSED_CHOICE_PICKER);
  const opener = useRef<HTMLButtonElement>(null);
  const now = useChoiceNow(choice);
  if (!canChangeChoice(choice, now)) return null;
  const free = choice.orgs.find((org) => org.slug === choice.freeOrgSlug);
  return (
    <Card className="gap-0 px-5 py-5 md:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("choice.settings.title")}</h2>
          <p className="text-sm text-ink-muted">
            {free
              ? t("choice.settings.picked", {
                  name: orgName(free),
                  day: formatCutoverDay(choice.cutoverAt, i18n.language),
                })
              : t("choice.settings.pending", {
                  date: formatCutoverDate(choice.cutoverAt, i18n.language),
                })}
          </p>
        </div>
        <Button
          ref={opener}
          variant="outline"
          className="self-start md:self-auto"
          onClick={() => setFrame(openChoicePicker())}
        >
          {free ? t("choice.settings.change") : t("choice.settings.choose")}
        </Button>
      </div>
      <FreeOrgPicker
        choice={choice}
        frame={frame}
        setFrame={setFrame}
        returnFocus={() => opener.current?.focus()}
      />
    </Card>
  );
}
