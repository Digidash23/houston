import { Spinner } from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import { FirstRunConversation } from "./first-run-conversation";
import type { ManagerOnboardingState } from "./manager-onboarding-context";
import { ProfileConversation } from "./profile-conversation";

/**
 * The onboarding the AI Manager runs in place of its chat. Every line is
 * authored copy and every answer is given on a step: no model is asked
 * anything, so it runs whether or not the manager itself can start. It opens
 * once the survey record has loaded, since the record is what the
 * conversation resumes from.
 */
export function ManagerOnboarding({
  state,
}: {
  state: ManagerOnboardingState;
}) {
  const { t } = useTranslation("assistant");
  if (state.survey.loading) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 text-ink-muted">
        <Spinner className="size-5" aria-label={t("opening")} />
        <p className="text-sm">{t("opening")}</p>
      </div>
    );
  }
  if (state.mode === "first_run") return <FirstRunConversation state={state} />;
  return <ProfileConversation state={state} />;
}
