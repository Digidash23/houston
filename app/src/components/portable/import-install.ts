/**
 * The install half of the "From a friend" flow: the engine round-trip. What
 * the round-trip asks for is decided in `import-install-request.ts`.
 */

import type {
  PortableInstalledAgent,
  PortableInstallRequest,
} from "@houston/engine-adapter";
import { seedBornConfig } from "../../lib/agent-provisioning/born-config";
import { analytics } from "../../lib/analytics";
import { getEngine } from "../../lib/engine";
import type { KickoffPin } from "../../lib/kickoff-pin";
import { queryClient } from "../../lib/query-client";
import { tauriProvider } from "../../lib/tauri";
import {
  type InstallImportedAgentArgs,
  importInstallRequest,
  lastUsedFromPin,
} from "./import-install-request";

/**
 * Install the package as a new employee, born with the provider/model the
 * user confirmed and its first day pending, like any new hire. The first day
 * starts on the user's click (`lib/agent-first-day.ts`), and the host reads
 * the brief off the job description the package carried.
 */
export async function installImportedAgent(
  args: InstallImportedAgentArgs,
  kickoffPin: KickoffPin,
): Promise<PortableInstalledAgent> {
  const request = {
    ...importInstallRequest(args),
    config: { ...kickoffPin, firstDay: "pending", arrival: "imported" },
  } satisfies PortableInstallRequest;
  const installed = await getEngine().importInstall(request);
  // Before the reveal adopts it: the first-day offer is on its board at once.
  seedBornConfig(queryClient, installed.agent.folderPath, request.config);
  // Keep the sticky last-used in sync (local, so it's cheap to await).
  const lastUsed = lastUsedFromPin(kickoffPin);
  if (lastUsed) {
    await tauriProvider.setLastUsed(lastUsed.provider, lastUsed.model);
  }
  analytics.track("agent_imported", { agent_slug: installed.agentName });
  return installed;
}
