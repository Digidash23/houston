import { createContext, type ReactNode, useContext } from "react";
import type { OnboardingSurveyState } from "../../../hooks/use-onboarding-survey";
import type { FirstRunStage } from "../../../lib/manager-onboarding/script";

/**
 * The onboarding the AI Manager is running, or null when it runs none and the
 * manager view is the real chat.
 *
 * - `first_run`: the first-run conversation, on the route's `stage`. `finish`
 *   completes onboarding (the funnel, the pending stage, the completed flag),
 *   and the route then hands the view to the real chat.
 * - `profile_completion`: the survey questions an existing account still owes,
 *   asked once; `close` hands the view back to the real chat.
 */
export type ManagerOnboardingState =
  | {
      mode: "first_run";
      stage: FirstRunStage;
      survey: OnboardingSurveyState;
      /** Every survey answer is saved: holds the route across the save gap. */
      onSurveyDone: () => void;
      finish: () => void;
    }
  | {
      mode: "profile_completion";
      survey: OnboardingSurveyState;
      close: () => void;
    };

const Context = createContext<ManagerOnboardingState | null>(null);

export function ManagerOnboardingProvider({
  value,
  children,
}: {
  value: ManagerOnboardingState | null;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useManagerOnboarding(): ManagerOnboardingState | null {
  return useContext(Context);
}
