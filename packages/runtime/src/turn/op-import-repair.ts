import { join, posix } from "node:path";
import { fetchWithRetry } from "@houston/runtime-client/object-sync";
import { loadFullConversation } from "../store/conversation-file";
import type { OpClaimTurn } from "./op-republish";
import type { TurnServerDeps } from "./server-types";
import type { TurnFilesystem } from "./turn-filesystem";
import { poolIdentity } from "./turn-store";

/**
 * After an import's files are durable, repair every conversation it wrote
 * into the transcript store with its FULL document (archived segments
 * folded in), the body the pod's transcript shadow sends on a repair. The
 * gateway serves an asleep agent's conversations from that store, which
 * otherwise learns of imported chats only when a pod next projects them.
 * Answers the diagnostics; a 404 (route absent) is not one.
 */
export async function repairImportedConversations(
  deps: Pick<TurnServerDeps, "poolStoreUrl" | "fetchImpl">,
  turn: OpClaimTurn,
  filesystem: TurnFilesystem,
  uploaded: readonly string[],
): Promise<string[]> {
  const baseUrl = deps.poolStoreUrl ?? process.env.HOUSTON_POOL_STORE_URL;
  if (!baseUrl) return [];
  const { org, agent } = poolIdentity(turn.gcsPrefix);
  const root = `${baseUrl.replace(/\/+$/, "")}/v1/pod/transcripts/${encodeURIComponent(org)}/${encodeURIComponent(agent)}/conversations`;
  const conversationsRel = posix.join(filesystem.dataRel, "conversations");
  const diagnostics: string[] = [];
  for (const [encoded, cid] of importedConversations(
    conversationsRel,
    uploaded,
  )) {
    try {
      // A lazy tree holds only what this op wrote or read: the live file
      // and every segment must be on disk before the full load.
      await filesystem.vfs.readBytes(
        posix.join(conversationsRel, `${encoded}.json`),
      );
      for (const key of await filesystem.vfs.list(
        posix.join(conversationsRel, `${encoded}.archive`),
      ))
        await filesystem.vfs.readBytes(key);
      const conversation = loadFullConversation(
        join(filesystem.dataDir, "conversations"),
        cid,
      );
      if (!conversation) {
        diagnostics.push(`transcript repair ${cid} skipped: file unreadable`);
        continue;
      }
      const fetchImpl = deps.fetchImpl ?? fetch;
      const response = await fetchWithRetry(
        (input, init) =>
          fetchImpl(input, { ...init, signal: AbortSignal.timeout(5_000) }),
        `${root}/${encodeURIComponent(cid)}/repair`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${turn.hostToken}`,
            "X-Houston-Claim-Token": turn.claim.token,
            "X-Houston-Claim-Boot": turn.claim.bootId,
            "X-Houston-Claim-Conversation": turn.conversationId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(conversation),
        },
      );
      await response.body?.cancel();
      if (!response.ok && response.status !== 404)
        diagnostics.push(
          `transcript repair ${cid} rejected (${response.status})`,
        );
    } catch (error) {
      diagnostics.push(
        `transcript repair ${cid} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return diagnostics;
}

/** `[encoded file name, conversation id]` of every conversation whose live
 *  file or archive segment the import uploaded. */
function importedConversations(
  conversationsRel: string,
  uploaded: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  const prefix = `${conversationsRel}/`;
  for (const rel of uploaded) {
    if (!rel.startsWith(prefix)) continue;
    const [name = "", segment] = rel.slice(prefix.length).split("/");
    const encoded =
      segment === undefined
        ? name.endsWith(".json") && name.slice(0, -".json".length)
        : name.endsWith(".archive") && name.slice(0, -".archive".length);
    if (!encoded) continue;
    try {
      out.set(encoded, decodeURIComponent(encoded));
    } catch {
      // Not a name the conversation store writes: nothing to repair.
    }
  }
  return out;
}
