import type { ServerResponse } from "node:http";
import {
  notInteractionOwnerBody,
  refusesInteractionAnswer,
} from "../store/interaction-owner";
import { json } from "./server-http";
import { type CardOwnerRead, startCardOwnerRead } from "./turn-card-owner-read";
import type { TurnFilesystemPreparation } from "./turn-filesystem";
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
  const { turn, timings } = input;
  const actingUserId =
    turn.actingAs && !turn.routine && !turn.shadow
      ? turn.actingAs.userId
      : undefined;
  let card: CardOwnerRead | undefined;
  try {
    if (actingUserId)
      card = startCardOwnerRead(
        turn,
        input.preparation.filesystem,
        input.resolved,
        timings,
      );
    await input.preparation.hydrated;
    timings.t_hydrated = performance.now();
    if (card && refusesInteractionAnswer(await card.messages(), actingUserId)) {
      await reportAbandonedTurnStartup(input.startup);
      json(input.res, 403, notInteractionOwnerBody);
      return true;
    }
    timings.t_card_checked = performance.now();
    const refused = await input.sandbox?.admission();
    if (refused) throw new TurnSetupError("message_refused", refused);
    return false;
  } catch (error) {
    // The turn root is removed behind this throw and the card read writes
    // there: stop it (a store read has no deadline), then wait.
    card?.abort();
    await card?.settled;
    await reportAbandonedTurnStartup(input.startup);
    throw error;
  }
}
