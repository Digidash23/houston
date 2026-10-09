import { Button } from "@houston-ai/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSession } from "../../../hooks/use-session";
import {
  clearCloudMigrationOutcome,
  readCloudMigrationOutcome,
} from "../../../lib/cloud-migration-outcome";
import { isHostedGatewayEngine } from "../../../lib/engine";
import { reportError } from "../../../lib/error-report";
import { osDetectLegacyHouston, osIsTauri } from "../../../lib/os-bridge";
import { queryKeys } from "../../../lib/query-keys";

/** This machine's wizard outcome (the key the wizard gate writes), or `null`. */
function readOutcome(userId: string | null): "done" | "skipped" | null {
  try {
    return readCloudMigrationOutcome(localStorage, userId);
  } catch (e) {
    reportError("cloud_migration_storage", "reading the outcome failed", e);
    return null;
  }
}

/**
 * The "Continue migration" section shows only when a re-run makes sense: a
 * hosted desktop build, legacy data still on THIS machine, and this machine's
 * migration not already completed ("done"). A hook the settings view calls to
 * gate the row. The detect query shares its key with the wizard gate's, so
 * React Query dedupes the filesystem scan. The completed state is the
 * device-level localStorage outcome (`lib/cloud-migration-outcome.ts`).
 */
export function useMigrationAvailable(): boolean {
  const { data: session } = useSession();
  const userId = session?.uid ?? null;
  const gates =
    isHostedGatewayEngine() && osIsTauri() && readOutcome(userId) !== "done";
  const detect = useQuery({
    queryKey: queryKeys.cloudMigrationDetect(),
    queryFn: async () => {
      try {
        return await osDetectLegacyHouston();
      } catch (e) {
        reportError(
          "cloud_migration_detect",
          e instanceof Error ? e.message : String(e),
          e,
        );
        throw e;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    enabled: gates,
    retry: false,
  });
  return gates && (detect.data?.hasWorkspaces ?? false);
}

/**
 * Lets a user re-run the cloud migration if a prior run was skipped or failed.
 * Clears the machine's outcome flag and reloads: on reboot the wizard gate
 * re-evaluates (no outcome, not completed, legacy data present) and reopens.
 */
export function MigrationSection() {
  const { t } = useTranslation("settings");
  const { data: session } = useSession();
  const userId = session?.uid ?? null;

  const handleContinue = () => {
    try {
      clearCloudMigrationOutcome(localStorage, userId);
    } catch (e) {
      reportError("cloud_migration_storage", "clearing the outcome failed", e);
    }
    location.reload();
  };

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">{t("migration.title")}</h2>
      <p className="text-sm text-ink-muted mb-4">
        {t("migration.description")}
      </p>
      <Button className="rounded-full" onClick={handleContinue}>
        {t("migration.button")}
      </Button>
    </section>
  );
}
