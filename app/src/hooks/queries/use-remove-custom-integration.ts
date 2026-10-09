import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { customRemovalPatches } from "../../lib/integration-cache-patches";
import { optimisticWrite } from "../../lib/optimistic-write";
import { tauriIntegrations } from "../../lib/tauri";

/** Remove a custom integration entirely (definition + secret + tools). The
 *  row leaves every list on the click; the write follows. */
export function useRemoveCustomIntegration(agentId?: string) {
  const qc = useQueryClient();
  const { t } = useTranslation("integrations");
  return useCallback(
    (slug: string) =>
      void optimisticWrite({
        qc,
        command: "custom_integration_remove",
        patches: customRemovalPatches(slug),
        write: () =>
          agentId
            ? tauriIntegrations.customRemoveForAgent(agentId, slug)
            : tauriIntegrations.customRemove(slug),
        failure: {
          title: t("writeFailed.removeCustom.title"),
          description: t("writeFailed.removeCustom.description"),
        },
      }),
    [qc, agentId, t],
  );
}
