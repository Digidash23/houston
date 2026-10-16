/**
 * Where the gateway sends the browser once Slack approves a connect.
 *
 * None named means the web app. `app` is the `houston://settings/channels`
 * deep link into an installed app, which the browser asks about before it
 * follows. `loopback` is a listener the desktop shell bound on
 * `127.0.0.1:<port>`: the gateway redirects to it with no prompt at all, and
 * the listener answers only a redirect carrying its `state`.
 */
export type SlackConnectReturn =
  | { kind: "app"; port?: never; state?: never }
  | { kind: "loopback"; port: number; state: string };

/** The gateway refuses anything outside the unprivileged port range. */
const MIN_PORT = 1024;
const MAX_PORT = 65535;

/** The nonce shape the gateway accepts, which a base64url `state` fits. */
const LOOPBACK_STATE = /^[A-Za-z0-9_-]{16,128}$/;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("'returnTo' must be an object when given");
  }
  return value as Record<string, unknown>;
}

/** A return target off an untrusted command payload. Absent or null is web. */
export function parseSlackConnectReturn(
  value: unknown,
): SlackConnectReturn | undefined {
  if (value === undefined || value === null) return undefined;
  const target = record(value);
  if (target.kind === "app") return { kind: "app" };
  if (target.kind !== "loopback") {
    throw new Error("'returnTo.kind' must be app or loopback");
  }
  const { port, state } = target;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < MIN_PORT ||
    port > MAX_PORT
  ) {
    throw new Error(
      `'returnTo.port' must be an integer ${MIN_PORT}-${MAX_PORT}`,
    );
  }
  if (typeof state !== "string" || !LOOPBACK_STATE.test(state)) {
    throw new Error("'returnTo.state' must be a 16-128 character nonce");
  }
  return { kind: "loopback", port, state };
}
