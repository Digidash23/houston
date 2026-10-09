import {
  AsyncButton,
  Button,
  HoustonAvatar,
  resolveAgentColor,
} from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import { useConnectAiGate } from "../../hooks/use-connect-ai-gate";
import type { Agent } from "../../lib/types";
import { FirstDayCompact } from "./first-day-cta";
import type { FirstDayPlacement } from "./first-day-model";
import { startFirstDay } from "./start-first-day";
import { useTrackFirstDayNeedsAi } from "./use-track-needs-ai";

/**
 * The team board's calm note while employees wait for their first day. Each
 * employee is a chip that starts that first day in one tap: the note already
 * says what the tap does, and the setup chat opens right here beside the
 * board, so a detour through the employee's own board would only add a step.
 * With no AI connected no first day could run, so the chips give way to one
 * button into the AI Hub (the composer's own gate).
 */
export function FirstDayBanner({ agents }: { agents: Agent[] }) {
  const { t } = useTranslation("board");
  const gate = useConnectAiGate();
  const needsAi = gate.active && gate.canConnect;
  useTrackFirstDayNeedsAi(needsAi, "banner");
  return (
    <section
      data-testid="first-day-banner"
      className="mx-3 mt-3 flex shrink-0 flex-col gap-3 rounded-xl bg-card px-4 py-3 ht-hairline"
    >
      <div>
        <p className="text-sm font-medium text-ink text-balance">
          {t(needsAi ? "firstDay.bannerNeedsAiTitle" : "firstDay.bannerTitle")}
        </p>
        <p className="text-sm text-ink-muted">
          {t(needsAi ? "firstDay.bannerNeedsAi" : "firstDay.bannerExplain")}
        </p>
      </div>
      {needsAi ? (
        <Button
          data-first-day-connect-ai="banner"
          className="h-11 w-full active:scale-[0.96] md:h-9 md:w-auto md:self-start"
          onClick={gate.connect}
        >
          {t("firstDay.connectAi")}
        </Button>
      ) : (
        <FirstDayChips agents={agents} />
      )}
    </section>
  );
}

/** One chip per waiting employee; a tap starts that employee's first day. */
function FirstDayChips({ agents }: { agents: Agent[] }) {
  const { t } = useTranslation("board");
  return (
    <ul className="flex flex-wrap gap-2">
      {agents.map((agent) => (
        <li key={agent.folderPath} className="min-w-0">
          <AsyncButton
            variant="secondary"
            data-first-day-start={agent.folderPath}
            aria-label={t("firstDay.start", { name: agent.name })}
            className="h-11 max-w-full pl-1.5 active:scale-[0.96] md:h-9"
            onClick={() => startFirstDay(agent)}
          >
            <HoustonAvatar
              color={resolveAgentColor(agent.color)}
              diameter={24}
            />
            <span className="truncate">{agent.name}</span>
          </AsyncButton>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a board shows ABOVE its tasks for the first day: the compact offer on
 * one employee's board, the banner on the team's. The hero is not here: it
 * replaces the empty board rather than leading it.
 */
export function FirstDayLead({
  placement,
}: {
  placement: FirstDayPlacement<Agent>;
}) {
  if (placement.kind === "compact")
    return <FirstDayCompact agent={placement.agent} />;
  if (placement.kind === "banner")
    return <FirstDayBanner agents={placement.agents} />;
  return null;
}
