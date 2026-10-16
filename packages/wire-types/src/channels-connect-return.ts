/**
 * Where the gateway sends the browser once Slack approves a connect, when it
 * is not the web app (none named).
 *
 * `app` is the deep link into an installed app (`houston://settings/channels`),
 * which the browser asks about first. `loopback` is the desktop shell's
 * listener on `127.0.0.1:<port>`, reached with no prompt; it answers only a
 * redirect carrying `state`. The `never` members let one body expression read
 * `port` and `state` off either variant, so an `app` return drops them from
 * the JSON.
 */
export type SlackConnectReturn =
  | { kind: "app"; port?: never; state?: never }
  | { kind: "loopback"; port: number; state: string };

export type SlackConnectReturnKind = SlackConnectReturn["kind"];

/** The gateway refuses a loopback port outside the unprivileged range. */
export const SLACK_LOOPBACK_MIN_PORT = 1024;
export const SLACK_LOOPBACK_MAX_PORT = 65535;

/** The nonce shape the gateway accepts as `state`; a base64url nonce fits. */
export const SLACK_LOOPBACK_STATE = /^[A-Za-z0-9_-]{16,128}$/;
