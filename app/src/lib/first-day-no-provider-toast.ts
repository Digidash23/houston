import { useUIStore } from "../stores/ui";
import i18n from "./i18n";
import { AI_HUB_VIEW_ID } from "./top-level-views";

/**
 * The copy for a first-day start the host or gateway refused because the
 * person has no AI connected (`409 first_day_no_provider`): an info toast
 * whose action opens the AI Hub, the same place the composer's connect-AI
 * state leads. Never the red bug pair and never Sentry. The start button
 * already offers the connect flow when the provider scan says nothing is
 * connected, so this meets a scan that had not caught up.
 */
export function showFirstDayNoProviderToast(): void {
  const ui = useUIStore.getState();
  ui.addToast({
    title: i18n.t("board:firstDay.noProvider.title"),
    description: i18n.t("board:firstDay.noProvider.body"),
    variant: "info",
    action: {
      label: i18n.t("board:firstDay.noProvider.action"),
      onClick: () => useUIStore.getState().setViewMode(AI_HUB_VIEW_ID),
    },
  });
}
