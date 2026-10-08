import { useUIStore } from "../stores/ui";
import i18n from "./i18n";

/**
 * The copy for a webhook-key mint or rotate the gateway refused because the
 * caller is not the routine's creator (`403 not_creator`): an info toast, the
 * whole surface of an expected business state. Never the red bug pair and
 * never Sentry. The chip hides the action for non-creators, so this meets a
 * stale routine row or a creator change since the page loaded.
 */
export function showWebhookNotCreatorToast(): void {
  useUIStore.getState().addToast({
    title: i18n.t("routines:webhook.creatorOnlyTitle"),
    description: i18n.t("routines:webhook.creatorOnlyBody"),
    variant: "info",
  });
}
