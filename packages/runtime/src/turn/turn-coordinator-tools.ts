import { join } from "node:path";
import { processAssistantCatalog } from "@houston/host/src/assistant/catalog-source";
import type { PiBackendDeps } from "../backends/pi/backend";
import { makeAssistantTools } from "../session/tools/assistant";
import type { AssistantToolOptions } from "../session/tools/assistant-call";
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
 * turn hydrated, not the process's (empty) store.
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
    ...makeMissionTools({ call: assistant.call, personalAssistant: true }),
    makeReadMissionTool({ call: assistant.call, personalAssistant: true }),
  ];
}
