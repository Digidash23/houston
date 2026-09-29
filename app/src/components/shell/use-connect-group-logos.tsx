import {
  SIDEBAR_CONNECT_LOGO_MAX,
  type SidebarConnectLogo,
} from "@houston-ai/layout";
import { useMemo } from "react";
import { useIntegrationConnections } from "../../hooks/queries";
import { useConnectedProviders } from "../../hooks/use-connected-providers";
import { connectedProviderIds } from "../../lib/connected-providers";
import { appDisplay } from "../integrations/app-display";
import { AppLogo } from "../integrations/app-logo";
import { curatedLogoUrl } from "../integrations/curated-logos";
import { INTEGRATION_PROVIDER } from "../integrations/model";
import {
  useIntegrationProviderReady,
  useToolkitBySlug,
} from "../integrations/use-toolkit-catalog";
import { bundledConnectAppLogo } from "./connect-apps-bundled-logos";
import {
  CONNECT_AI_FALLBACK,
  pickConnectAppIds,
  pickConnectLogoIds,
} from "./connect-group-logos";
import { providerBrandColor } from "./provider-brand-colors";
import { providerBrandKey } from "./provider-logo-map";
import { ProviderGlyph } from "./provider-logos";

/**
 * The logos on the connect group's two rows (`connect-group.tsx`), read from
 * the queries the Integrations page and the model picker already hold:
 * nothing here fetches or caches on its own, so the rows and those screens
 * always agree. Which ids are drawn is `connect-group-logos.ts`. The tile
 * sizes every element the same, so both rows' logos match.
 */

/**
 * The person's connected apps, filled to three with Gmail, Outlook and
 * Slack. Those three draw their bundled marks, always, so the row shows
 * three logos before the catalog lands (or with no catalog at all) and never
 * swaps an image when it does. A connected app draws once its logo is known:
 * a bundled curated mark, or the catalog's own logo.
 */
export function useConnectAppsLogos(): SidebarConnectLogo[] {
  // The rail is always mounted: read connections only once the provider is
  // ready, as the catalog beside them does.
  const ready = useIntegrationProviderReady();
  const connections = useIntegrationConnections(INTEGRATION_PROVIDER, ready);
  const bySlug = useToolkitBySlug();
  return useMemo(() => {
    const connected = connections.data
      ?.filter((connection) => connection.status === "active")
      .map((connection) => connection.toolkit);
    const knownLogo = (slug: string) =>
      curatedLogoUrl(slug) || bySlug.get(slug)?.logoUrl || "";
    return pickConnectAppIds({
      connected: connected ?? null,
      knownLogo,
      max: SIDEBAR_CONNECT_LOGO_MAX,
    }).map((slug) => ({
      id: slug,
      // Square corners: the brand's own art carries its shape, and a radius
      // would clip it at this size.
      element: (
        <AppLogo
          display={{
            ...appDisplay(slug, bySlug.get(slug)),
            logoUrl: bundledConnectAppLogo(slug) || knownLogo(slug),
          }}
          size="xs"
          className="rounded-none"
        />
      ),
    }));
  }, [connections.data, bySlug]);
}

/**
 * A provider's brand mark on its tile. A mark with no brand colour
 * draws in the current theme's ink, so it reads in both themes.
 */
function ProviderMark({ providerId }: { providerId: string }) {
  const color = providerBrandColor(providerId);
  return (
    <span className="flex text-ink" style={color ? { color } : undefined}>
      <ProviderGlyph providerId={providerId} className="size-full" />
    </span>
  );
}

/**
 * The person's connected AI providers, filled to three with Anthropic, OpenAI
 * and Google.
 * Every provider mark ships in the bundle, so each is drawable; two ids that
 * share a brand's art are drawn once.
 */
export function useConnectAiLogos(): SidebarConnectLogo[] {
  const connected = connectedProviderIds(useConnectedProviders());
  return pickConnectLogoIds({
    connected,
    fallback: CONNECT_AI_FALLBACK,
    drawable: () => true,
    identity: (id) => providerBrandKey(id) ?? id,
    max: SIDEBAR_CONNECT_LOGO_MAX,
  }).map((id) => ({ id, element: <ProviderMark providerId={id} /> }));
}
