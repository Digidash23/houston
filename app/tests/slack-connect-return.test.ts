import { deepStrictEqual, rejects, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { SlackConnectReturn } from "@houston/wire-types";
import {
  connectSlackWithReturn,
  type SlackReturnListener,
} from "../src/lib/slack-connect-return.ts";

const URL = "https://slack.com/oauth/v2/authorize?state=opaque";
const STATE = "q9X-_3abcDEF4567";

/** Records every step in order, so "listener before connect" is checkable. */
function harness(opts: { startFails?: boolean; connectFails?: boolean } = {}) {
  const steps: string[] = [];
  const reported: string[] = [];
  const listener: SlackReturnListener = {
    start: async (state) => {
      steps.push(`start ${state}`);
      if (opts.startFails) throw new Error("bind refused");
      return { port: 53124, attemptId: 7 };
    },
    cancel: async (attemptId) => {
      steps.push(`cancel ${attemptId}`);
    },
  };
  const connect = async (returnTo: SlackConnectReturn | undefined) => {
    steps.push(`connect ${JSON.stringify(returnTo ?? null)}`);
    if (opts.connectFails) throw new Error("gateway said 503");
    return URL;
  };
  const deps = {
    listener,
    newState: () => STATE,
    report: (command: string, err: unknown) =>
      reported.push(`${command}: ${(err as Error).message}`),
  };
  return { steps, reported, connect, deps };
}

describe("a desktop Slack connect", () => {
  it("binds the listener first and names its port and state", async () => {
    const { steps, reported, connect, deps } = harness();
    strictEqual(await connectSlackWithReturn(connect, deps), URL);
    deepStrictEqual(steps, [
      "start q9X-_3abcDEF4567",
      'connect {"kind":"loopback","port":53124,"state":"q9X-_3abcDEF4567"}',
    ]);
    deepStrictEqual(reported, []);
  });

  it("reports a listener that cannot start and returns over the deep link", async () => {
    const { steps, reported, connect, deps } = harness({ startFails: true });
    strictEqual(await connectSlackWithReturn(connect, deps), URL);
    deepStrictEqual(steps, [
      "start q9X-_3abcDEF4567",
      'connect {"kind":"app"}',
    ]);
    deepStrictEqual(reported, ["start_channels_loopback: bind refused"]);
  });

  it("frees the listener when the connect fails, and still fails", async () => {
    const { steps, connect, deps } = harness({ connectFails: true });
    await rejects(connectSlackWithReturn(connect, deps), {
      message: "gateway said 503",
    });
    deepStrictEqual(steps, [
      "start q9X-_3abcDEF4567",
      'connect {"kind":"loopback","port":53124,"state":"q9X-_3abcDEF4567"}',
      "cancel 7",
    ]);
  });

  it("reports a cancel that fails", async () => {
    const { reported, connect, deps } = harness({ connectFails: true });
    deps.listener.cancel = async () => {
      throw new Error("lock poisoned");
    };
    await rejects(connectSlackWithReturn(connect, deps));
    await new Promise((resolve) => setImmediate(resolve));
    deepStrictEqual(reported, ["cancel_channels_loopback: lock poisoned"]);
  });
});

describe("a web Slack connect", () => {
  it("names no return and binds nothing", async () => {
    const { steps, connect, deps } = harness();
    strictEqual(
      await connectSlackWithReturn(connect, { ...deps, listener: null }),
      URL,
    );
    deepStrictEqual(steps, ["connect null"]);
  });
});
