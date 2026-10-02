import { posix } from "node:path";
import type { TurnFilesystem } from "./turn-filesystem";

/**
 * Leaf module — op-apply and op-route both need these, and op-apply already
 * imports op-route for dispatch. Keeping the shared scope helpers in either
 * of them closes an import cycle, which the esbuild bundle (selfhost
 * bundle.mjs) turns into a boot deadlock once any module in the graph uses
 * top-level await: each side's evaluation awaits the other's forever, the
 * event loop empties, and the worker exits without a line of output. Plain
 * ESM (tsx/node on sources) tolerates the cycle, so only bundled pool
 * workers died. Nothing here may import another ./op-* module.
 */

/** The shape of `OpResult["include"]` without importing op-apply. */
export type OpInclude = (relativePath: string) => boolean;

/** Everything an agent-level route may touch: the agent's whole directory
 *  (family files, skills, markdown, any agentfile path the pod would
 *  accept) — never the runtime tree (conversations, sessions, auth), which
 *  stays conversation-scoped. Mirrors the pod-store's ops-claim scope. */
export function agentRouteScope(workspaceRel: string): OpInclude {
  // Deliberately WIDER than the turn predicate (turn-agent-scope): an op runs
  // under the serialized agent-ops claim, which the store grants the whole
  // non-runtime tree; a turn claim gets only its own doc files.
  const root = `${workspaceRel}/`;
  const runtime = `${posix.join(workspaceRel, ".houston", "runtime")}/`;
  return (rel) => rel.startsWith(root) && !rel.startsWith(runtime);
}

/**
 * A migration import's scope (the agent-import claim): the agent route scope
 * plus the runtime transcripts it unpacks, their archive segments (a long
 * desktop conversation arrives rotated, store/conversation-archive.ts), and
 * the pi sessions synthesized from them. Nothing else of the runtime tree.
 */
export function importScope(workspaceRel: string, dataRel: string): OpInclude {
  const agent = agentRouteScope(workspaceRel);
  const conversations = `${posix.join(dataRel, "conversations")}/`;
  const sessions = `${posix.join(dataRel, "sessions")}/`;
  return (rel) => {
    if (agent(rel) || rel.startsWith(sessions)) return true;
    if (!rel.startsWith(conversations)) return false;
    const [name = "", segment, ...deeper] = rel
      .slice(conversations.length)
      .split("/");
    if (segment === undefined) return name.endsWith(".json");
    return (
      deeper.length === 0 &&
      name.endsWith(".archive") &&
      segment.endsWith(".json")
    );
  };
}

/** One conversation's file + sessions. */
export function conversationScope(dataRel: string, cid: string): OpInclude {
  const file = posix.join(
    dataRel,
    "conversations",
    `${encodeURIComponent(cid)}.json`,
  );
  const sessions = `${posix.join(dataRel, "sessions", cid)}/`;
  return (rel) => rel === file || rel.startsWith(sessions);
}

/**
 * The engine's agent id ("Workspace/Agent") from the hydrated layout. The
 * gateway's envelope names the agent by SLUG; turns never need the engine
 * id (the layout resolver finds the single agent), but the host handlers
 * address the agent by its id — so it is derived here, never trusted.
 */
export function engineAgentId(
  filesystem: Pick<TurnFilesystem, "workspaceRel">,
): string {
  return filesystem.workspaceRel.replace(/^workspaces\//, "");
}
