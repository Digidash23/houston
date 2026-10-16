/**
 * Which return a Slack connect asks the gateway for, and the desktop listener
 * that return needs.
 *
 * Web names none and lands back in the tab it came from. The desktop binds a
 * loopback listener first and names its port and a fresh `state`, so the
 * approving browser returns over plain `http://127.0.0.1` with no "Open
 * Houston?" prompt. A listener that cannot start falls back to the
 * `houston://` deep link, which still finishes in the app after that prompt.
 */

import type { SlackConnectReturn } from "@houston/wire-types";

/** The shell's Slack return listener (`osStart/CancelChannelsLoopback`). */
export interface SlackReturnListener {
  start(state: string): Promise<{ port: number; attemptId: number }>;
  cancel(attemptId: number): Promise<void>;
}

export interface SlackConnectDeps {
  /** Null where there is no shell to listen (web). */
  listener: SlackReturnListener | null;
  /** A base64url nonce (`generateState`). */
  newState: () => string;
  /** Reports an unexpected failure the person never sees. */
  report: (command: string, err: unknown) => void;
}

/**
 * Run `connect` with the return this surface can take, and hand back its URL.
 * A listener is freed again when `connect` throws, since no browser will ever
 * come back to it.
 */
export async function connectSlackWithReturn(
  connect: (returnTo: SlackConnectReturn | undefined) => Promise<string>,
  { listener, newState, report }: SlackConnectDeps,
): Promise<string> {
  if (listener === null) return connect(undefined);
  const state = newState();
  let started: { port: number; attemptId: number };
  try {
    started = await listener.start(state);
  } catch (err) {
    report("start_channels_loopback", err);
    return connect({ kind: "app" });
  }
  try {
    return await connect({ kind: "loopback", port: started.port, state });
  } catch (err) {
    listener
      .cancel(started.attemptId)
      .catch((cancelErr: unknown) =>
        report("cancel_channels_loopback", cancelErr),
      );
    throw err;
  }
}
