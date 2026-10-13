import {
  type HeartbeatDoc,
  type HeartbeatTurnEnd,
  loadHeartbeatDoc,
  settleHeartbeatRun,
} from "@houston/domain";
import { type ChatMessage, isHeartbeat } from "@houston/protocol";
import type { Workspace } from "../domain/types";
import type { EventHub } from "../events/hub";
import { conversationKey, type WorkspacePaths } from "../paths";
import type { ChannelCtx, RuntimeChannel } from "../ports";
import { ASSISTANT_CONVERSATION_ID } from "../routes/assistant";
import type { FireLock } from "../schedule/fire-lock";
import { providerErrorSummary } from "../schedule/run-failure";
import type { Vfs } from "../vfs";

export interface SettleDeps {
  vfs: Vfs;
  paths: WorkspacePaths;
  channel: RuntimeChannel;
  lock: FireLock;
  events?: EventHub;
}

/** How the pending briefing turn stands, read off the manager's transcript. */
export type BriefingTurnState =
  | { kind: "running" }
  | { kind: "completed" }
  | { kind: "failed"; reason: string };

/**
 * The pending turn's state. While the manager is busy it is still running
 * (or the person is talking to it; either way, look again next tick). Idle:
 * the briefing's hidden message at or after `sinceMs`, and its turn's replies
 * (by turn id, else up to the next user message). The last reply carrying a
 * provider error, or no reply at all, is a failed briefing.
 */
export function briefingTurnState(
  messages: readonly ChatMessage[],
  sinceMs: number,
  busy: boolean,
): BriefingTurnState {
  if (busy) return { kind: "running" };
  const at = messages.findLastIndex(
    (m) => m.role === "user" && m.ts >= sinceMs && isHeartbeat(m.content),
  );
  const prompt = messages[at];
  if (!prompt)
    return { kind: "failed", reason: "the briefing never reached the chat" };
  const after = messages.slice(at + 1);
  const nextUser = after.findIndex((m) => m.role === "user");
  const untilNextUser = nextUser === -1 ? after : after.slice(0, nextUser);
  const turn = prompt.turnId
    ? after.filter((m) => m.turnId === prompt.turnId)
    : untilNextUser;
  const last = turn.filter((m) => m.role === "assistant").at(-1);
  if (!last)
    return {
      kind: "failed",
      reason: "the briefing turn ended without a reply",
    };
  if (last.providerError)
    return { kind: "failed", reason: providerErrorSummary(last.providerError) };
  return { kind: "completed" };
}

async function readTranscript(
  deps: SettleDeps,
  ctx: ChannelCtx,
): Promise<ChatMessage[]> {
  const raw = await deps.vfs.readText(
    conversationKey(
      deps.paths,
      ctx.workspace,
      ctx.agent,
      ASSISTANT_CONVERSATION_ID,
    ),
  );
  return raw
    ? ((JSON.parse(raw) as { messages?: ChatMessage[] }).messages ?? [])
    : [];
}

/**
 * Settle an admitted briefing once its turn is over: the baseline moves and
 * the person is told only for a turn that finished with a reply. Returns the
 * document as it now stands.
 */
export async function settlePendingBriefing(
  deps: SettleDeps,
  ws: Workspace,
  ctx: ChannelCtx,
  doc: HeartbeatDoc,
  now: Date,
): Promise<HeartbeatDoc> {
  const { pending } = doc;
  if (!pending) return doc;
  const state = briefingTurnState(
    await readTranscript(deps, ctx),
    Date.parse(pending.at),
    await deps.channel.busy(ctx),
  );
  if (state.kind === "running") return doc;
  const at = now.toISOString();
  const end: HeartbeatTurnEnd =
    state.kind === "completed"
      ? { kind: "completed", at }
      : { kind: "failed", at, reason: state.reason };
  const settled = await settleHeartbeatRun(deps.vfs, ws.id, end);
  // Another replica settled it first: it also told the person.
  if (!settled) return loadHeartbeatDoc(deps.vfs, ws.id);
  const first = await deps.lock.setNx(
    `heartbeat:settled:${ws.id}:${pending.at}`,
    "1",
    2 * 86_400,
  );
  deps.events?.emit(ws.ownerUserId, {
    type: "HeartbeatChanged",
    workspaceId: ws.id,
  });
  if (first && state.kind === "completed")
    deps.events?.emit(ws.ownerUserId, {
      type: "HeartbeatDelivered",
      agentPath: ctx.agent.id,
      date: settled.last?.date ?? at.slice(0, 10),
    });
  return settled;
}
