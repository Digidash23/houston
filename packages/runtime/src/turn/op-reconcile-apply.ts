import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createRoutineRun,
  loadRoutineRuns,
  loadRoutines,
  pruneRoutineRuns,
  routineConversationId,
  saveRoutineRuns,
} from "@houston/domain";
import type { Agent, Workspace } from "@houston/host/src/domain/types";
import type { EventHub } from "@houston/host/src/events/hub";
import { LocalPaths } from "@houston/host/src/paths";
import {
  type ReconcileDeps,
  reconcileAgentRuns,
} from "@houston/host/src/schedule/reconcile";
import { withRunsFile } from "@houston/host/src/schedule/runs-lock";
import { LocalWorkspaceStore } from "@houston/host/src/store/local";
import { PrefixedVfs } from "@houston/host/src/vfs";
import type { ChatMessage, HoustonEvent } from "@houston/protocol";
import type { AbandonedTurn, ReconcileOp } from "./op-grammar-reconcile";
import { repairSurfacedCards } from "./op-reconcile-board";
import { settleAbandonedChat } from "./op-reconcile-chat";
import { engineAgentId } from "./op-scope";
import type { TurnFilesystem } from "./turn-filesystem";

export interface ReconcileApplied {
  events: HoustonEvent[];
  /** The chat's interruption reply for the dead turn, for the store. */
  line?: ChatMessage;
  /** What became of the dead turn's chat (the reply body names it). */
  chat: string;
  /** Not this worker's agent, or a chat over the read cap: decline. */
  decline?: true;
}

/**
 * The reconcile op over the hydrated tree, before any sync-back: the dead
 * turn's chat gets its interruption reply, a lost routine fire gets the run
 * row its sandbox never uploaded, and the host's own reconcile settles the
 * conversation's running rows exactly as a pod's scheduler would. The worker
 * holds this conversation's claim and nothing else, so nothing outside it is
 * settled here.
 */
export async function applyReconcileOp(
  op: ReconcileOp,
  filesystem: TurnFilesystem,
): Promise<ReconcileApplied> {
  const agentId = engineAgentId(filesystem);
  const store = new LocalWorkspaceStore(
    join(filesystem.storeRoot, "workspaces"),
  );
  const agent = await store.getAgent(agentId);
  const ws = agent ? await store.getWorkspace(agent.workspaceId) : null;
  if (!agent || !ws)
    return { events: [], chat: "agent_missing", decline: true };
  const events: HoustonEvent[] = [];
  const { abandoned } = op;
  let chat = "none";
  let line: ChatMessage | undefined;
  if (abandoned) {
    const settled = await settleAbandonedChat(
      filesystem,
      op.conversationId,
      abandoned,
    );
    if ("tooLarge" in settled)
      return { events: [], chat: "too_large", decline: true };
    if ("line" in settled) {
      line = settled.line;
      chat = settled.written ? "settled" : "already_settled";
      if (settled.written)
        events.push({ type: "ConversationsChanged", agentPath: agentId });
    } else {
      chat = settled.skipped;
    }
  }
  const deps: ReconcileDeps = {
    vfs: new PrefixedVfs(filesystem.vfs, "workspaces"),
    paths: new LocalPaths(),
    // The conversation claim is the exclusivity: no other writer settles
    // this conversation's runs while the op holds it.
    lock: { setNx: async () => true },
    events: collect(events),
    now: () => new Date(),
    newId: randomUUID,
    // Never here: the hydrated routines would overwrite a concurrent edit.
    // The caller snoozes/pauses after its sync-back, from the durable history.
    settleWalls: async () => {},
  };
  if (abandoned?.routine)
    await recordLostRun(deps, ws, agent, op.conversationId, abandoned);
  await reconcileAgentRuns(deps, ws, agent, {
    conversationId: op.conversationId,
    ...(abandoned ? { abandoned: new Set([abandoned.turnId]) } : {}),
  });
  const root = deps.paths.agentRoot(ws, agent);
  const now = new Date().toISOString();
  if (await repairSurfacedCards(deps.vfs, root, op.conversationId, now))
    events.push({ type: "ActivityChanged", agentPath: agentId });
  return { events, chat, ...(line ? { line } : {}) };
}

/**
 * A pooled fire writes its run row only into its own tree and uploads it
 * settled, so a fire whose sandbox died left no row anywhere. Record it as
 * running from its first claim's start; the reconcile that follows settles
 * it. A routine since deleted, or a chat no routine maps to, has no history
 * to show it in.
 */
async function recordLostRun(
  deps: ReconcileDeps,
  ws: Workspace,
  agent: Agent,
  conversationId: string,
  abandoned: AbandonedTurn,
): Promise<void> {
  const root = deps.paths.agentRoot(ws, agent);
  const { items: routines } = await loadRoutines(deps.vfs, root);
  const routine = routines.find(
    (r) => routineConversationId(r, abandoned.turnId) === conversationId,
  );
  if (!routine) return;
  await withRunsFile(root, async () => {
    const { items: runs } = await loadRoutineRuns(deps.vfs, root);
    if (runs.some((r) => r.id === abandoned.turnId)) return;
    const lost = createRoutineRun(
      routine,
      abandoned.turnId,
      abandoned.startedAt,
    );
    await saveRoutineRuns(deps.vfs, root, pruneRoutineRuns([lost, ...runs]));
  });
}

function collect(into: HoustonEvent[]): EventHub {
  return {
    emit: (_userId, event) => {
      into.push(event);
    },
    subscribe: () => () => {},
  };
}
