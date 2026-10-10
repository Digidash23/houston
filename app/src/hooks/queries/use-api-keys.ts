import type { ApiKey } from "@houston/engine-adapter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { apiKeysWithout } from "../../lib/account-cache-patches";
import { apiKeysSupported } from "../../lib/api-keys-model";
import { optimisticWrite } from "../../lib/optimistic-write";
import { queryKeys } from "../../lib/query-keys";
import { tauriApiKeys } from "../../lib/tauri";
import { useCapabilities } from "../use-capabilities";

/**
 * C9 personal API-key hooks (`GET/POST/DELETE /v1/keys`). Hosted-gateway only:
 * every hook self-gates on `capabilities.apiKeys`, so off-cloud (desktop,
 * self-host) the query never fires and the section never renders.
 *
 * The wire calls route through `tauriApiKeys.*` → the engine adapter's `call()`
 * wrapper, which surfaces any failure once as a red bug toast + Sentry report
 * (the required no-silent-failures path). So these hooks carry no `onError` — a
 * second toast would double up (same as `use-billing.ts`). The one exception is
 * the mint's `key_limit`, which `tauriApiKeys.create` silences so the section
 * can render it inline; the mutation error is read by the caller for that.
 * Revoking is optimistic and owns its refusal toast (`optimisticWrite`).
 */

/** The caller's active API keys, newest first. Enabled only on a gateway that
 *  serves the public API. */
export function useApiKeys() {
  const { capabilities } = useCapabilities();
  return useQuery<ApiKey[]>({
    queryKey: queryKeys.apiKeys(),
    queryFn: () => tauriApiKeys.list(),
    enabled: apiKeysSupported(capabilities),
    staleTime: 30_000,
  });
}

/**
 * Mint a personal API key. On success the full secret is returned to the caller
 * (for the one-time reveal) and the list is invalidated so the new key appears;
 * the secret is deliberately NOT written into any cache. A `key_limit` rejection
 * is surfaced inline by the caller (see the hook-file doc), not toasted.
 */
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => tauriApiKeys.create(name.trim()),
    // The mutation cache keeps a settled mutation's result (the secret) for
    // `gcTime` after its last observer leaves: drop it the moment the dialog or
    // chat card that minted it is gone.
    gcTime: 0,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.apiKeys() });
    },
  });
}

/** Revoke a key by id: the row leaves on the click, the write follows. A key
 *  already gone (404) is success: `tauriApiKeys.revoke` resolves it. */
export function useRevokeApiKey() {
  const qc = useQueryClient();
  const { t } = useTranslation("settings");
  return useCallback(
    (id: string) =>
      void optimisticWrite({
        qc,
        command: "revoke_api_key",
        patches: [
          {
            queryKey: queryKeys.apiKeys(),
            apply: (keys: ApiKey[] | undefined) => apiKeysWithout(keys, id),
          },
        ],
        write: () => tauriApiKeys.revoke(id),
        failure: {
          title: t("writeFailed.revokeApiKey.title"),
          description: t("writeFailed.revokeApiKey.description"),
        },
      }),
    [qc, t],
  );
}
