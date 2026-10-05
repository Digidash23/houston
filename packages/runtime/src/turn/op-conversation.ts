import { join, posix } from "node:path";
import { LazyReadRefusedError } from "@houston/host/src/vfs";
import {
  deleteConversationAt,
  renameConversationMutationAt,
} from "../store/conversation-file";
import type { OpResult } from "./op-result";
import { conversationScope, engineAgentId } from "./op-scope";
import type { OpRequest } from "./parse-op-request";
import type { TurnFilesystem } from "./turn-filesystem";

const json = (status: number, value: unknown) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(value),
});

export async function applyConversationOp(
  op: OpRequest & { op: Extract<OpRequest["op"], { kind: "conversation" }> },
  filesystem: TurnFilesystem,
): Promise<OpResult> {
  const agentId = engineAgentId(filesystem);
  const { conversationId, action } = op.op;
  const dir = join(filesystem.dataDir, "conversations");
  const include = conversationScope(filesystem.dataRel, conversationId);
  const notFound = {
    ...json(404, { error: "conversation not found" }),
    events: [],
    include,
  };
  const conversationsRel = posix.join(filesystem.dataRel, "conversations");
  const fileRel = posix.join(
    conversationsRel,
    `${encodeURIComponent(conversationId)}.json`,
  );
  // Existence from the listing: a lazy tree answers it without a
  // download (the pod's 404 for an unknown conversation, same contract).
  const exists = (await filesystem.vfs.list(conversationsRel)).includes(
    fileRel,
  );
  if (!exists) return notFound;
  if (action === "delete") {
    // Deletes need no bytes: tombstone the file and the session dir so
    // a lazy tree never downloads what it is about to remove.
    await filesystem.vfs.deleteKey(fileRel);
    await filesystem.vfs.deletePrefix(
      posix.join(filesystem.dataRel, "sessions", conversationId),
    );
    deleteConversationAt(dir, conversationId);
  } else {
    // A rename reads the file: materialize it (a hydrated tree already
    // has it). Over the read cap the pod must do it — decline.
    try {
      await filesystem.vfs.readBytes(fileRel);
    } catch (error) {
      if (!(error instanceof LazyReadRefusedError)) throw error;
      return {
        ...json(503, { error: "conversation too large to edit asleep" }),
        events: [],
        include,
        decline: true,
      };
    }
    const renamed = renameConversationMutationAt(
      dir,
      conversationId,
      op.op.title ?? "",
    );
    if (renamed === null) return notFound;
  }
  return {
    ...json(200, { ok: true }),
    events: [{ type: "ConversationsChanged", agentPath: agentId }],
    include,
  };
}
