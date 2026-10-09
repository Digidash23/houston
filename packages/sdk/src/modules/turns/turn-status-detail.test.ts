import { expect, test } from "vitest";
import type { FeedOutput } from "./feed-output";
import { MultiplexFeedOutput } from "./feed-output-multiplex";
import { COMPUTE_BUSY_MESSAGE } from "./send-busy";
import { SEND_LOST_MESSAGE, STREAM_LOST_MESSAGE } from "./stream-tuning";
import type { SessionStatusDetail } from "./turn-error-class";
import {
  ENGINE_RESTART_MESSAGE,
  STOPPED_BY_USER,
  TURN_DIED_MESSAGE,
  TURN_FAILED_MESSAGE,
} from "./turn-errors";
import { SEND_BUSY_MESSAGE } from "./turn-running";
import {
  finishErr,
  finishOk,
  finishPlanLimit,
  newTurnState,
  settleProviderErrorCard,
} from "./turn-settle";

/**
 * Every settle stamps WHY the turn ended on its session status, from the
 * typed input it was given, so analytics never reads a cause off the chat
 * copy (which hides it by design, HOU-705): before this, 85% of the fleet's
 * session failures classified as `unknown`.
 */

type Status = [string, string | undefined, SessionStatusDetail | undefined];

function recorder() {
  const statuses: Status[] = [];
  const output: FeedOutput = {
    pushFeedItem: () => {},
    sessionStatus: (_a, _s, status, error, detail) => {
      statuses.push([status, error, detail]);
    },
    persistBoardStatus: async () => {},
  };
  return { statuses, output };
}

function errored(
  msg: string,
  notice?: Parameters<typeof finishErr>[2],
): Status {
  const { statuses, output } = recorder();
  finishErr(newTurnState("Houston/Bo", "c1", output), msg, notice);
  return statuses[statuses.length - 1];
}

test.each([
  [STOPPED_BY_USER, undefined, "stopped"],
  [ENGINE_RESTART_MESSAGE, "engine_restart", "engine_restart"],
  [SEND_BUSY_MESSAGE, "send_busy", "send_busy"],
  [COMPUTE_BUSY_MESSAGE, "compute_busy", "compute_busy"],
  [TURN_DIED_MESSAGE, undefined, "turn_died"],
  [SEND_LOST_MESSAGE, undefined, "send_lost"],
  [STREAM_LOST_MESSAGE, undefined, "stream_lost"],
  [TURN_FAILED_MESSAGE, undefined, "unexplained"],
  ["Model refused the request.", undefined, "engine_verdict"],
] as const)("finishErr(%j, %j) stamps %s", (msg, notice, errorClass) => {
  const [status, error, detail] = errored(msg, notice);
  expect(status).toBe("error");
  expect(detail).toEqual({ origin: "sent", errorClass });
  // The copy is untouched: a Stop still carries no text, a failure its line.
  expect(error).toBe(errorClass === "stopped" ? undefined : msg);
});

test("a not-connected refusal settles as the provider card's class", () => {
  const [status, error, detail] = errored(
    "No provider connected. Log in with Claude or Codex first.",
  );
  expect(status).toBe("error");
  expect(error).toBeUndefined();
  expect(detail).toEqual({
    origin: "sent",
    errorClass: "provider_unauthenticated",
  });
});

test("a typed provider card and a plan refusal carry their kind", () => {
  const { statuses, output } = recorder();
  settleProviderErrorCard(newTurnState("Houston/Bo", "c1", output), {
    kind: "rate_limited",
    provider: "anthropic",
    model: null,
    retry_after_seconds: 30,
    message: "slow down",
  });
  finishPlanLimit(newTurnState("Houston/Bo", "c2", output), {
    code: "message_limit",
    limit: 50,
    resetsAt: "2026-10-10T00:00:00Z",
    error: "limit",
  });
  expect(statuses.map((s) => s[2]?.errorClass)).toEqual([
    "provider_rate_limited",
    "provider_plan_message_limit",
  ]);
});

test("a clean settle carries the origin and no class; an observer's is observed", () => {
  const { statuses, output } = recorder();
  finishOk(newTurnState("Houston/Bo", "c1", output));
  finishOk(newTurnState("Houston/Bo", "c2", output, { mode: "observer" }));
  finishErr(
    newTurnState("Houston/Bo", "c3", output, { mode: "observer" }),
    TURN_DIED_MESSAGE,
  );
  expect(statuses).toEqual([
    ["completed", undefined, { origin: "sent" }],
    ["completed", undefined, { origin: "observed" }],
    [
      "error",
      TURN_DIED_MESSAGE,
      { origin: "observed", errorClass: "turn_died" },
    ],
  ]);
});

test("the multiplexer forwards the detail to every output", () => {
  const a = recorder();
  const b = recorder();
  finishErr(
    newTurnState(
      "Houston/Bo",
      "c1",
      new MultiplexFeedOutput([a.output, b.output]),
    ),
    SEND_LOST_MESSAGE,
  );
  const detail = { origin: "sent", errorClass: "send_lost" };
  expect(a.statuses[0]?.[2]).toEqual(detail);
  expect(b.statuses[0]?.[2]).toEqual(detail);
});
