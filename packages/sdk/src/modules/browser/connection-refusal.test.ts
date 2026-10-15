import { describe, expect, it } from "vitest";

import { flush, httpError, liveHarness } from "./live-test-kit";
import {
  BROWSER_LIVE_HEALTHY_MS,
  BROWSER_LIVE_MAX_ATTEMPTS,
} from "./reconnect-policy";

const waiting = {
  type: "status",
  handoffId: "handoff-1",
  state: "waiting",
  text: "Sign in",
  expiresAt: 600_000,
} as const;

describe("the browser live stream's refusals", () => {
  it("reports a refused stream once per episode; a healthy stream re-arms it", async () => {
    const h = liveHarness();
    const refusal = httpError(400, '{"error":"invalid_input"}');
    h.streams[0].reject(refusal);
    await flush();
    await h.advance(500);
    h.streams[1].reject(refusal);
    await flush();
    expect(h.handlers.onUnexpected).toHaveBeenCalledTimes(1);
    await h.advance(1000);
    h.streams[2].onEvent(waiting);
    await h.advance(BROWSER_LIVE_HEALTHY_MS);
    h.streams[2].reject(refusal);
    await flush();
    expect(h.handlers.onUnexpected).toHaveBeenCalledTimes(2);
  });

  it("retry() after lost starts a new episode", async () => {
    const h = liveHarness();
    const refusal = httpError(400, "{}");
    for (let i = 0; i <= BROWSER_LIVE_MAX_ATTEMPTS; i++) {
      h.streams[i].reject(refusal);
      await flush();
      await h.advance(8000);
    }
    expect(h.states.at(-1)).toEqual({ kind: "lost" });
    expect(h.handlers.onUnexpected).toHaveBeenCalledTimes(1);
    h.connection.retry();
    h.streams[BROWSER_LIVE_MAX_ATTEMPTS + 1].reject(refusal);
    await flush();
    expect(h.handlers.onUnexpected).toHaveBeenCalledTimes(2);
  });
});
