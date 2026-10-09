import type { Capabilities } from "@houston/engine-adapter";
import { firstDayRefusal } from "@houston/sdk/agents/first-day-refusal";
import { pickerEmptyState } from "../components/chat-model-selector-labels";
import { useUIStore } from "../stores/ui";
import { analytics } from "./analytics";
import i18n from "./i18n";
import { providerName } from "./providers";
import { queryClient } from "./query-client";
import { queryKeys } from "./query-keys";
import { AI_HUB_VIEW_ID } from "./top-level-views";

/**
 * The copy for a first-day start the host or gateway refused because the
 * person has no AI connected (`409 first_day_no_provider`): an info toast,
 * never the red bug pair and never Sentry. When the refusal names the hire's
 * saved provider (signed out, while another AI may be connected) the copy
 * says to reconnect THAT one. The action opens the AI Hub, the place the
 * composer's connect-AI state leads, only when the viewer can reach it (the
 * gate's own `canConnect`); otherwise the copy stands alone.
 */
export function showFirstDayNoProviderToast(error: unknown): void {
  const provider = firstDayRefusal(error)?.provider;
  analytics.track("agent_first_day_needs_ai", {
    surface: "refused",
    ...(provider ? { provider } : {}),
  });
  const name = provider ? providerName(provider) : null;
  const ui = useUIStore.getState();
  ui.addToast({
    title: name
      ? i18n.t("board:firstDay.reconnect.title", { provider: name })
      : i18n.t("board:firstDay.noProvider.title"),
    description: name
      ? i18n.t("board:firstDay.reconnect.body", { provider: name })
      : i18n.t("board:firstDay.noProvider.body"),
    variant: "info",
    ...(canReachAiHub()
      ? {
          action: {
            label: name
              ? i18n.t("board:firstDay.reconnect.action")
              : i18n.t("board:firstDay.noProvider.action"),
            onClick: () => useUIStore.getState().setViewMode(AI_HUB_VIEW_ID),
          },
        }
      : {}),
  });
}

/** The gate's `canConnect`, off the cached capabilities (no React here). */
function canReachAiHub(): boolean {
  const key = queryKeys.capabilities();
  const status = queryClient.getQueryState(key)?.status;
  return pickerEmptyState({
    teamSpace: false,
    capabilities: queryClient.getQueryData<Capabilities>(key) ?? null,
    capabilitiesLoaded: status === "success" || status === "error",
  }).canConnect;
}
