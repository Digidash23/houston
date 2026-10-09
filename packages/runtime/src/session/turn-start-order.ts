import { canonicalPinProvider, isProvider } from "../ai/providers";
import { serveModeOn } from "../auth/serve";
import { conversations } from "./conversation-cache";
import type { TurnPin } from "./exec-turn";
import { pinnedProviderUnavailable } from "./provider-gate";
import {
  type CardAnswer,
  refuseQueuedCardAnswer,
  reportPinnedProviderUnavailable,
  type TurnStartFailure,
} from "./turn-start-failure";

/**
 * Run a turn's pre-run failure write (its message and an error reply) in the
 * conversation's turn order, after the card-owner re-check: while a card is
 * live, only the person it is for may answer it, and a reply written after a
 * running turn's card would retire that card. A refused send writes nothing.
 *
 * No cached conversation means no turn is running or queued on it here: a
 * queued turn holds its conversation in the cache (`pending`), so the write
 * runs now.
 */
export function inTurnOrder(
  failure: TurnStartFailure,
  answer: CardAnswer | undefined,
  write: () => void,
): Promise<void> {
  const step = () => {
    if (!refuseQueuedCardAnswer(failure.id, failure.turnId, answer)) write();
  };
  const conv = conversations.get(failure.id);
  if (!conv) {
    step();
    return Promise.resolve();
  }
  const run = conv.queue.then(step);
  conv.queue = run.catch(() => {});
  return run;
}

/**
 * Refuse a turn pinned to a provider this workspace has no credential for
 * (serve mode), in turn order. Resolves true when the turn ended here.
 */
export async function refusePinnedProvider(
  failure: TurnStartFailure,
  pin: TurnPin | undefined,
  answer: CardAnswer | undefined,
): Promise<boolean> {
  const provider = pin?.provider ? canonicalPinProvider(pin.provider) : null;
  if (
    !serveModeOn() ||
    !provider ||
    !isProvider(provider) ||
    !(await pinnedProviderUnavailable(provider))
  )
    return false;
  await inTurnOrder(failure, answer, () =>
    reportPinnedProviderUnavailable(failure, provider),
  );
  return true;
}
