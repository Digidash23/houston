import type { Transport } from "@earendil-works/pi-ai";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * The `createAgentSession` options that pin pi's provider transport, or none.
 *
 * With no transport named, nothing is passed and pi builds its own
 * `SettingsManager.create(cwd, agentDir)`, so its default (`auto`) stays in
 * force. With one named, the SAME settings are built the same way and only the
 * transport is overridden, in memory: every other setting (retry, thinking
 * defaults) is unchanged and nothing is written back to settings.json. pi reads
 * the transport once, when it builds the session's agent.
 */
export function piTransportSettings(
  cwd: string,
  agentDir: string,
  transport: Transport | undefined,
): { settingsManager?: SettingsManager } {
  if (!transport) return {};
  const settingsManager = SettingsManager.create(cwd, agentDir);
  settingsManager.applyOverrides({ transport });
  return { settingsManager };
}
