/**
 * Whether the AI Manager's view can be opened: discovery serves an assistant,
 * or the manager is running onboarding. Onboarding is scripted and local, so
 * it runs on a deployment that serves no manager and before discovery answers;
 * its row and its screen must stay reachable for exactly that long.
 */
export function managerReachable(input: {
  showAssistant: boolean;
  onboardingActive: boolean;
}): boolean {
  return input.showAssistant || input.onboardingActive;
}
