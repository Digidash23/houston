import { useManagerOnboarding } from "../components/assistant/onboarding/manager-onboarding-context";
import { managerReachable } from "../lib/manager-reachable";
import { useSurfaceGates } from "./use-surface-gates";

/** The live binding of {@link managerReachable}: the ONE answer the pinned
 *  Manager rows read, so the rail and the phone roster never disagree. */
export function useManagerReachable(): boolean {
  const { showAssistant } = useSurfaceGates();
  const onboarding = useManagerOnboarding();
  return managerReachable({
    showAssistant,
    onboardingActive: onboarding !== null,
  });
}
