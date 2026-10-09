import type { ServerResponse } from "node:http";
import { dirname, join, posix } from "node:path";
import {
  ObjectNotFoundError,
  type ReadResult,
} from "@houston/runtime-client/object-sync";
import { loadConversation } from "../store/conversation-file";
import {
  notInteractionOwnerBody,
  refusesInteractionAnswer,
} from "../store/interaction-owner";
import { json } from "./server-http";
import type {
  TurnFilesystem,
  TurnFilesystemPreparation,
} from "./turn-filesystem";
import { turnHydrationError } from "./turn-hydration-error";
import { TurnSetupError } from "./turn-layout";
import {
  reportAbandonedTurnStartup,
  type TurnSessionStartupTask,
} from "./turn-session-startup";
import type { ResolvedTurnStore } from "./turn-store";
import type { TurnRequest } from "./types";

/**
 * The last refusals a pooled turn can meet, once its tree is hydrated and
 * before the stream opens. Resolves true when the turn was refused and already
 * answered; an overlapped session startup is abandoned on every refusal.
 *
 * While a card is live, only the person it is for may answer it. A message
 * from anyone else is a plain 403 JSON answer, never a setup-error frame: the
 * gateway maps the worker's 403 to its own, and neither the turnlog nor the
 * transcript may record a turn that never ran. Routine runs are exempt: they
 * share one conversation and act as different people (the creator on
 * schedule, whoever clicked "run now").
 */
export async function refuseHydratedTurn(input: {
  turn: TurnRequest;
  preparation: TurnFilesystemPreparation;
  resolved: ResolvedTurnStore;
  sandbox: { admission: () => Promise<string | null> } | null;
  startup: TurnSessionStartupTask | undefined;
  timings: Record<string, number>;
  res: ServerResponse;
}): Promise<boolean> {
  try {
    const filesystem = await input.preparation.hydrated;
    input.timings.t_hydrated = performance.now();
    const { turn } = input;
    if (turn.actingAs && !turn.routine && !turn.shadow) {
      const messages = await claimedMessages(turn, filesystem, input.resolved);
      if (refusesInteractionAnswer(messages, turn.actingAs.userId)) {
        await reportAbandonedTurnStartup(input.startup);
        json(input.res, 403, notInteractionOwnerBody);
        return true;
      }
    }
    const refused = await input.sandbox?.admission();
    if (refused) throw new TurnSetupError("message_refused", refused);
    return false;
  } catch (error) {
    await reportAbandonedTurnStartup(input.startup);
    throw error;
  }
}

/**
 * The conversation as the store holds it under this turn's claim. A prefetched
 * turn hydrated bytes the gateway read BEFORE it held the claim, so the card
 * the previous turn ended on can be missing from them. The object is read
 * again, past the prefetch, unless the store confirms it is still at the
 * hydrated generation; a store that cannot confirm sends it in full. A read
 * failure is answered like a failure during hydration.
 */
async function claimedMessages(
  turn: TurnRequest,
  filesystem: TurnFilesystem,
  resolved: ResolvedTurnStore,
) {
  const file = `${encodeURIComponent(turn.conversationId)}.json`;
  const hydrated = () =>
    loadConversation(
      join(filesystem.dataDir, "conversations"),
      turn.conversationId,
    )?.messages ?? [];
  if (!turn.prefetch || !resolved.live) return hydrated();
  const scratch = join(dirname(filesystem.storeRoot), "card-owner");
  const key = posix.join(filesystem.dataRel, "conversations", file);
  const held = filesystem.manifest.get(key)?.generation;
  const live = resolved.live;
  const read = (destFile: string) => {
    const at = resolved.prefix ? posix.join(resolved.prefix, key) : key;
    const opts = held ? { ifGenerationNotMatch: held } : undefined;
    return live.downloadVersioned
      ? live.downloadVersioned(at, destFile, opts)
      : live.download(at, destFile).then(() => ({}) as ReadResult);
  };
  try {
    if ((await read(join(scratch, file))).notModified) return hydrated();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return [];
    throw turnHydrationError(error);
  }
  return loadConversation(scratch, turn.conversationId)?.messages ?? [];
}
