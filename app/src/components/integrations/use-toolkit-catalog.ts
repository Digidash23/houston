import type { IntegrationToolkit } from "@houston/engine-adapter";
import { useMemo } from "react";
import {
  useIntegrationStatus,
  useIntegrationToolkits,
} from "../../hooks/queries";
import { INTEGRATION_PROVIDER } from "./model";

/**
 * Whether the integration provider is READY (the Houston session push has
 * landed). The single home for the readiness predicate the provider's reads
 * gate on, so a still-warming gateway or an unset provider never fires a
 * failing call from a surface the person did not open.
 */
export function useIntegrationProviderReady(): boolean {
  const status = useIntegrationStatus();
  return !!status.data?.find((p) => p.provider === INTEGRATION_PROVIDER)?.ready;
}

/**
 * The integration provider's toolkit catalog, gated on the provider being
 * ready (`useIntegrationProviderReady`).
 */
export function useReadyToolkitCatalog() {
  return useIntegrationToolkits(
    INTEGRATION_PROVIDER,
    useIntegrationProviderReady(),
  );
}

/**
 * The ready toolkit catalog indexed by slug — the one source for turning a
 * machine slug into its display identity through {@link appDisplay}. Memoized
 * on the catalog data so consumers get a stable map across renders.
 */
export function useToolkitBySlug(): Map<string, IntegrationToolkit> {
  const catalog = useReadyToolkitCatalog();
  return useMemo(
    () => new Map((catalog.data ?? []).map((tk) => [tk.slug, tk])),
    [catalog.data],
  );
}
