import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { customEditPatches } from "../../lib/integration-cache-patches";
import { optimisticWrite } from "../../lib/optimistic-write";
import { queryKeys } from "../../lib/query-keys";
import { tauriIntegrations } from "../../lib/tauri";

/** Rename a custom integration / set its website: every list shows the new
 *  details on Save, and the write follows. */
export function useEditCustomIntegration(agentId?: string) {
  const qc = useQueryClient();
  const { t } = useTranslation("integrations");
  return useCallback(
    (input: { slug: string; name: string; website: string }) =>
      void optimisticWrite({
        qc,
        command: "custom_integration_update_details",
        patches: customEditPatches(input.slug, input),
        write: () =>
          tauriIntegrations.customUpdateDetails(
            input.slug,
            { name: input.name, website: input.website },
            agentId,
          ),
        failure: {
          title: t("writeFailed.editCustom.title"),
          description: t("writeFailed.editCustom.description"),
        },
        invalidate: [
          queryKeys.customIntegrations(),
          queryKeys.integrationConnections("custom"),
        ],
      }),
    [qc, agentId, t],
  );
}
