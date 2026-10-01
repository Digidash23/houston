import { join } from "node:path";
import type { ProviderOption } from "@houston/domain";
import { processAssistantCatalog } from "@houston/host/src/assistant/catalog-source";
import { OPENAI_COMPATIBLE } from "../ai/openai-compatible-model";
import { connectedProviderChoices } from "../ai/provider-choices";
import type { PiBackendDeps } from "../backends/pi/backend";
import { makeAssistantTools } from "../session/tools/assistant";
import type { AssistantToolOptions } from "../session/tools/assistant-call";
import { makeCoordinatorCredentialTool } from "../session/tools/coordinator-credential";
import { makeRequestConnectionTool } from "../session/tools/integrations";
import { makeMissionTools } from "../session/tools/missions";
import { makeReadMissionTool } from "../session/tools/read-mission";
import { getHistoryAt } from "../store/conversation-file";
import type { TurnSessionRequest } from "./turn-session";

/**
 * The AI Manager's own tools on a pooled turn: the operation family and the
 * mission tools, both over THIS turn's sandbox facade, which is where the
 * turn's Houston credential lives (never in the tools).
 *
 * A long-lived coordinator builds the same set once per process
 * (session/assistant-family.ts, session/host-tools.ts). A pool worker cannot:
 * the turn, not the process, says whether it is the coordinator.
 */

/** The family's catalog and transport, or undefined when this turn is not
 *  the coordinator, has no facade, or the build carries no readable catalog. */
export function turnAssistantOptions(
  turn: TurnSessionRequest,
): AssistantToolOptions | undefined {
  if (turn.role !== "coordinator" || !turn.sandbox) return undefined;
  const catalog = processAssistantCatalog();
  return catalog ? { catalog, call: turn.sandbox.call } : undefined;
}

/**
 * `dataDir` is the turn's own: houston_recall searches the transcript this
 * turn hydrated, not the process's (empty) store. The connection card and the
 * key-entry tool are here rather than behind the `integrations` scope: Houston
 * never runs an integration, so the gateway does not grant it one.
 */
export function buildTurnCoordinatorTools(
  turn: TurnSessionRequest,
  dataDir: string,
): PiBackendDeps["customTools"] {
  const assistant = turnAssistantOptions(turn);
  if (!assistant) return [];
  const conversations = join(dataDir, "conversations");
  return [
    ...makeAssistantTools(assistant, (id) => getHistoryAt(conversations, id)),
    ...makeMissionTools({
      call: assistant.call,
      personalAssistant: true,
      providers: missionProviders(),
      resolveProviders: missionProviders,
    }),
    makeReadMissionTool({ call: assistant.call, personalAssistant: true }),
    makeRequestConnectionTool(),
    makeCoordinatorCredentialTool(assistant),
  ];
}

/**
 * The providers a mission may pin, by catalog. A worker's own credential
 * store holds nothing (the turn's credential lives in the turn's data dir),
 * so whether one is connected is for the agent the mission lands on to judge,
 * against its own credentials, exactly as when Houston runs on its pod. The
 * OpenAI-compatible endpoint keeps the runtime's own answer: its settings
 * live in a runtime, not in a credential row.
 */
function missionProviders(): ProviderOption[] {
  return connectedProviderChoices().map((option) => ({
    ...option,
    connected: option.id === OPENAI_COMPATIBLE ? option.connected : true,
  }));
}
