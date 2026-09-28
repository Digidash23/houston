import type { Toast } from "@houston-ai/core";
import { AppWorkspace } from "../../app-workspace";
import type { MigrationReconnectState } from "../../hooks/use-migration-reconnect";
import type { OnboardingSurveyState } from "../../hooks/use-onboarding-survey";
import type { OnboardingRoute } from "../../lib/onboarding-route";
import { useUIStore } from "../../stores/ui";
import { ManagerOnboardingHost } from "../assistant/onboarding/manager-onboarding-host";
import { CloudMigrationGate } from "../onboarding/cloud-migration/cloud-migration-gate";
import { MigrationReconnectScreen } from "../onboarding/migration-reconnect-screen";
import { ClaudeBrowserLogin } from "./claude-browser-login";
import { ProviderLoginFallback } from "./provider-login-fallback";

/**
 * The gate tree App renders once the auth and boot gates have cleared.
 *
 * The cloud-migration gate (HOU-719) wraps everything below the auth gates:
 * on the hosted desktop build it offers to move this machine's OLD local
 * data into the user's cloud agents. It must sit ABOVE the first-run branch —
 * a migrating user has zero cloud agents and would otherwise be captured by
 * first-run onboarding. It renders its children untouched
 * whenever the trigger says no (non-hosted builds, web, no legacy data,
 * already done/declined).
 *
 * Onboarding happens INSIDE the shell, in the AI Manager's chat
 * (`ManagerOnboardingHost`, below the migration gate so a migrating user never
 * starts a first run): a first run (the route is not `"app"`) and the survey
 * prompt an existing account still owes both open the manager's view, which
 * runs the scripted conversation in place of the real chat.
 *
 * The login fallback rides alongside the shell so a sign-in launched from a
 * surface without its own login handler (the in-chat reconnect card) still
 * opens the browser / dialog. The migration-reconnect branch is the
 * CO-LOCATED upgrade moment (workspaces migrated in place, no
 * provider connected) — see useMigrationReconnect for its trigger.
 */
export function AppRoutes({
  route,
  survey,
  showSurveyPrompt,
  migrationReconnect,
  onFirstRunSurveyDone,
  onCompletionPromptClosed,
}: {
  route: OnboardingRoute;
  survey: OnboardingSurveyState;
  showSurveyPrompt: boolean;
  migrationReconnect: MigrationReconnectState;
  onFirstRunSurveyDone: () => void;
  onCompletionPromptClosed: () => void;
}) {
  const toasts = useUIStore((s) => s.toasts);
  const dismissToast = useUIStore((s) => s.dismissToast);
  const mappedToasts: Toast[] = toasts.map((t) => {
    const base = t.description ? `${t.title} ${t.description}` : t.title;
    return {
      id: t.id,
      // Coalesced repeats (store addToast) surface their tally, so a retried
      // failure still visibly reacts instead of silently refreshing.
      message: t.count && t.count > 1 ? `${base} (×${t.count})` : base,
      variant: t.variant ?? "info",
      action: t.action,
    };
  });

  return (
    <CloudMigrationGate>
      <ManagerOnboardingHost
        route={route}
        survey={survey}
        showSurveyPrompt={showSurveyPrompt}
        onFirstRunSurveyDone={onFirstRunSurveyDone}
        onCompletionPromptClosed={onCompletionPromptClosed}
      >
        {route === "app" && migrationReconnect.show ? (
          <>
            <ProviderLoginFallback />
            <ClaudeBrowserLogin />
            <MigrationReconnectScreen onDone={migrationReconnect.dismiss} />
          </>
        ) : (
          <AppWorkspace toasts={mappedToasts} onDismissToast={dismissToast} />
        )}
      </ManagerOnboardingHost>
    </CloudMigrationGate>
  );
}
