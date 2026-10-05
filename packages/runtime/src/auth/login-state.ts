import type { LoginInfo } from "@houston/runtime-client";
import type { ProviderId } from "../ai/providers";
import { currentCredentialScope } from "../session/acting-context";
export type LoginState = {
  status: "starting" | "awaiting_user" | "complete" | "error";
  info?: LoginInfo;
  error?: string;
  resolvePaste?: (code: string) => void;
  rejectPaste?: (err: Error) => void;
  abort?: AbortController;
  /** Abandoned-login timer; cleared when the flow settles. */
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * In-flight logins, keyed by `<credential scope>:<provider>` — see `activeKey`.
 */
export const active = new Map<string, LoginState>();

/**
 * The `active` slot an in-flight login occupies. Scoped, because ONE runtime
 * serves every member of a team space (HOU-976) and each request runs inside its
 * own acting identity: a provider-only key handed member B the one-time device
 * code member A was still typing (B would have connected A's provider account),
 * and let B's cancel/logout tear down A's flow. Every read AND write of `active`
 * goes through here so no site can forget the scope. The team scope (desktop,
 * self-host, every no-identity request) keeps its own `team:<provider>` slot, so
 * its behavior is unchanged.
 */
export function activeKey(provider: ProviderId): string {
  return `${currentCredentialScope().key}:${provider}`;
}

/**
 * Overall cap on an in-flight login. An abandoned flow is not just stale UI
 * state: the browser/loopback flows hold pi's in-process OAuth callback server
 * bound to the provider's FIXED port (Codex: 1455) until they settle, which
 * blocks every future sign-in for that provider MACHINE-WIDE — any other
 * Houston instance, and the desktop relay's own local bind, all need that
 * exact port. Matches the local client watcher's own 10-minute cap.
 */
export const LOGIN_TIMEOUT_MS = 10 * 60_000;

/**
 * Stable sentinel the frontend localizes for the failure toast. Mirrors
 * `PROVIDER_LOGIN_TIMEOUT_ERROR` in `@houston-ai/core` (ui/core/src/
 * provider-login.ts) — the runtime is frontend-agnostic and cannot import ui
 * packages, so the string is duplicated by value; keep the two in sync.
 */
export const LOGIN_TIMEOUT_ERROR = "Login timed out";

/**
 * Stable sentinel for a GitHub account that finished the device flow but has
 * no Copilot subscription: GitHub's token exchange answers 403
 * `no_copilot_access` (with `can_signup_for_limited: true` — the user can
 * enable Copilot Free themselves). The raw body is a JSON blob that includes
 * the user's GitHub handle, so it must never reach the toast. Mirrors
 * `PROVIDER_COPILOT_NO_ACCESS_ERROR` in `@houston-ai/core` (ui/core/src/
 * provider-login.ts) — duplicated by value like LOGIN_TIMEOUT_ERROR above;
 * keep the two in sync.
 */
export const COPILOT_NO_ACCESS_ERROR =
  "Your GitHub account doesn't have Copilot access yet. Enable GitHub Copilot on github.com (the Free plan works), then try connecting again.";

/**
 * Collapse a provider login failure to a stable sentinel where the raw
 * message is unfit for the failure toast; every other message passes through
 * verbatim (beta policy: the real reason, never a generic swallow). A
 * pass-through message is still logged raw by the caller for the bug-report
 * log tail; a collapsed one is an expected business state whose raw body
 * carries the user's GitHub handle, so the caller logs a fixed line instead.
 */
export function loginFailureMessage(provider: ProviderId, raw: string): string {
  if (
    provider === "github-copilot" &&
    (raw.includes("no_copilot_access") ||
      raw.includes("No access to GitHub Copilot"))
  )
    return COPILOT_NO_ACCESS_ERROR;
  return raw;
}

export function clearLoginExpiry(state: LoginState): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = undefined;
}

/**
 * (Re)start the abandoned-login clock. On expiry the flow is torn down exactly
 * like `cancelLogin` (abort stops device-code pollers; the rejected paste
 * promise closes the loopback callback server and frees its port) but the
 * state stays in `active` as an ERROR, like any other failed login, so status
 * polls surface "Login timed out" instead of silently forgetting the attempt.
 * Re-armed when `startLogin` reuses an in-flight login, so every connect click
 * gets the full window.
 */
export function armLoginExpiry(provider: ProviderId, state: LoginState): void {
  clearLoginExpiry(state);
  // Capture the acting scope before the timer loses the request context.
  const key = activeKey(provider);
  const timer = setTimeout(() => {
    if (active.get(key) !== state) return;
    if (state.status !== "starting" && state.status !== "awaiting_user") return;
    // Record before abort so the login rejection handler preserves this error.
    state.status = "error";
    state.error = LOGIN_TIMEOUT_ERROR;
    console.warn(
      `[oauth:${provider}] abandoned login timed out after ${LOGIN_TIMEOUT_MS / 60_000}min — aborting to free the callback port`,
    );
    state.abort?.abort();
    state.rejectPaste?.(new Error(LOGIN_TIMEOUT_ERROR));
    // Drop dead paste hooks so a late completion gets "no active login".
    state.resolvePaste = undefined;
    state.rejectPaste = undefined;
  }, LOGIN_TIMEOUT_MS);
  // Bookkeeping must never hold the process open.
  timer.unref?.();
  state.timer = timer;
}

export function getLoginStatus(provider: string) {
  const state = active.get(activeKey(provider as ProviderId));
  return state
    ? { status: state.status, info: state.info, error: state.error }
    : null;
}
