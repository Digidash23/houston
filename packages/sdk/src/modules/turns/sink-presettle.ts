import { PresettlePoll } from "./presettle-poll";
import { presettleFromHistory } from "./settle-from-history";
import { finishGone } from "./turn-notices";
import type { TurnState } from "./turn-settle";
import type { TurnSinkOptions } from "./turn-sink-options";

/** What a turn sink lends its pre-settled poll. */
export interface SinkPresettleDeps {
  s: TurnState;
  o: TurnSinkOptions;
  /** The send was accepted, nothing ran on the stream, nothing settles. */
  canArm(): boolean;
  /** Live evidence landed (or a Stop muted the sink) mid-reload. */
  hasEvidence(): boolean;
  adoptTurnId(turnId: string): void;
  /** The poll settled the turn: the sink stops its stream. */
  settled(): void;
}

/**
 * The turn sink's pre-settled poll (`presettle-poll.ts`): each tick is one
 * conclusive-only history settle, and a conversation that stays not found
 * settles the turn as lost (`finishGone`). Settling only closes this
 * client's stream; nothing is cancelled on the server.
 */
export function sinkPresettlePoll(d: SinkPresettleDeps): PresettlePoll {
  return new PresettlePoll(d.o.presettledPollMs, {
    canArm: d.canArm,
    check: async () => {
      const verdict = await presettleFromHistory(
        d.s,
        d.o.reloadHistory,
        d.s.turnId,
        d.o.historyGuard,
        d.hasEvidence,
        d.adoptTurnId,
      );
      if (verdict === "settled") d.settled();
      return verdict;
    },
    gone: () => {
      finishGone(d.s);
      d.settled();
    },
  });
}
