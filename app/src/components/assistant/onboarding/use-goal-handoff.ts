import { useState } from "react";
import { useTranslation } from "react-i18next";
import { analytics } from "../../../lib/analytics";
import { normalizeLocale } from "../../../lib/locale";
import {
  type HandoffAbout,
  handoffPrompt,
} from "../../../lib/manager-onboarding/handoff-prompt";
import type { ManagerReach } from "../../../lib/manager-onboarding/script";
import { useAgentStore } from "../../../stores/agents";
import { useManagerHandoffStore } from "../../../stores/manager-handoff";

/** The person's answer to starting on their goal now. */
export type HandoffChoice = "accepted" | "declined";

/**
 * The answer to the closing's offer to start on the person's automation
 * goal. Either answer finishes onboarding the same way (`finish`, which saves
 * the conversation first); "Yes" also leaves the real chat its first message:
 * the person's "Yes, let's do it" over an instruction to get the goal
 * started, naming who they are and the team as it stands once the
 * conversation is saved.
 */
export function useGoalHandoff({
  goal,
  about,
  reach,
  finish,
}: {
  goal: string;
  /** Who the person is, as the survey told it. */
  about: HandoffAbout;
  reach: ManagerReach;
  finish: (then?: () => void) => void;
}): {
  choice: HandoffChoice | null;
  accept: () => void;
  decline: () => void;
} {
  const { t, i18n } = useTranslation("assistant");
  const [choice, setChoice] = useState<HandoffChoice | null>(null);

  const answer = (picked: HandoffChoice, then?: () => void) => {
    if (choice !== null) return;
    setChoice(picked);
    analytics.track("onboarding_goal_handoff", { choice: picked });
    finish(then);
  };

  return {
    choice,
    accept: () =>
      answer("accepted", () =>
        useManagerHandoffStore.getState().handOff({
          text: t("onboarding.handoff.yes"),
          context: handoffPrompt({
            goal,
            about,
            team: useAgentStore
              .getState()
              .agents.map(({ name, role }) => ({ name, role })),
            locale: normalizeLocale(i18n.resolvedLanguage) ?? "en",
            reach,
          }),
        }),
      ),
    decline: () => answer("declined"),
  };
}
