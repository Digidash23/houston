import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { persistTurnClaudeFlags } from "./turn-claude-flags";
import type { TurnFilesystem } from "./turn-filesystem";
import { recordPooledTokenSpend } from "./turn-ledger";
import type { TurnOutcome } from "./turn-session-types";

/**
 * The turn's writes that bypass its synced tree, landed beside the sync and
 * before the terminal frame: the claim authorizing them ends there. The
 * acting member's Claude flag cache, and the spend a standing pod folds into
 * its runtime dir after every turn (turn-ledger.ts).
 */
export async function landTurnSideWrites(input: {
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  root: string;
  conversationId: string;
  userId: string | undefined;
  spend: TurnOutcome["spend"];
}): Promise<void> {
  const { store, prefix, filesystem, root, spend } = input;
  await Promise.all([
    persistTurnClaudeFlags({
      store,
      prefix,
      filesystem,
      root,
      conversationId: input.conversationId,
      userId: input.userId,
    }),
    spend &&
      recordPooledTokenSpend({
        store,
        prefix,
        dataRel: filesystem.dataRel,
        provider: spend.provider,
        usage: spend.usage,
        scratchDir: root,
      }),
  ]);
}
