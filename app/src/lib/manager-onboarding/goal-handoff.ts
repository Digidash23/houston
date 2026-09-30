import type { ManagerHandoff } from "../../stores/manager-handoff.ts";
import type { SupportedLocale } from "../locale.ts";
import { nextFreeAgentColor } from "../next-agent-color.ts";
import {
  type HandoffAbout,
  type HandoffEmployee,
  handoffPrompt,
} from "./handoff-prompt.ts";
import { encodeGoalCard } from "./onboarding-card-markers.ts";
import type { ManagerReach } from "./script-types.ts";

export interface GoalHandoffInput {
  goal: string | null;
  about: HandoffAbout;
  reach: ManagerReach | null;
  team: readonly HandoffEmployee[];
  colors: readonly (string | undefined)[];
  locale: SupportedLocale;
}

/** Transcript import completes before the real chat takes its first turn. */
export function queueGoalHandoff(
  latch: { current: boolean },
  input: GoalHandoffInput,
  finish: (then?: () => void) => void,
  put: (handoff: ManagerHandoff) => void,
): void {
  if (latch.current) return;
  latch.current = true;
  if (input.goal === null || input.reach === null) {
    finish();
    return;
  }
  const { goal, about, team, colors, locale } = input;
  finish(() =>
    put({
      text: encodeGoalCard({ goal }),
      context: handoffPrompt({
        goal,
        about,
        team,
        freeColor: nextFreeAgentColor([...colors]),
        locale,
      }),
      grants: ["createAgent"],
    }),
  );
}

/**
 * Whether a goal card may start its goal again with the hire grant: only for
 * the goal the person set in their own survey, which the manager cannot
 * write. A card whose goal came from anywhere else (history the manager
 * imported) must never turn the person's click into an approval.
 */
export function mayRetryGoal(
  goal: string,
  ownGoal: string | null | undefined,
): boolean {
  return typeof ownGoal === "string" && ownGoal !== "" && goal === ownGoal;
}
