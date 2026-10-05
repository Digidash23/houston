/**
 * Multi-provider OAuth login, driven server-side and relayed to the webapp.
 *
 * - anthropic (Claude): the SUBSCRIPTION login, driven by the bundled Claude
 *   Code CLI running next to this runtime (the one sanctioned OAuth client —
 *   the direct PKCE replay is server-blocked since 2026-04): open the authorize
 *   URL, approve, paste back the code the callback page shows. Where no CLI can
 *   run, the token paste flow (an `sk-ant-…` value stored as api_key) remains
 *   the fallback — see auth/anthropic-cli-login.ts.
 * - openai-codex (ChatGPT/Codex): the CLIENT picks. A co-located desktop client
 *   sends `deviceAuth: false` and gets the browser/loopback login — the user
 *   approves in their own browser and the localhost callback finishes it, no
 *   code. A remote webapp (cloud or self-host) sends `deviceAuth: true` and gets
 *   the device-code grant — the user types a one-time code while the runtime
 *   polls. See `codexLoginMethod`.
 */
import {
  clearCustomEndpointConfig,
  OPENAI_COMPATIBLE,
} from "../ai/openai-compatible";
import { piProviderIds } from "../ai/pi-catalog";
import {
  activeProvider,
  isProvider,
  PROVIDERS,
  type ProviderId,
} from "../ai/providers";
import {
  logoutAnthropicCredential,
  refreshAnthropicCredential,
} from "../backends/claude/credential-status";
import {
  currentCredentialScope,
  isPersonalScope,
} from "../session/acting-context";
import { active, activeKey, clearLoginExpiry } from "./login-state";
import { authStorage, providerConnected } from "./storage";

export {
  autoPromptAnswer,
  codexLoginMethod,
  OPENAI_CODEX_BROWSER_LOGIN_METHOD,
  OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD,
} from "./login-policy";
export { startLogin } from "./login-start";
export {
  COPILOT_NO_ACCESS_ERROR,
  getLoginStatus,
  LOGIN_TIMEOUT_ERROR,
  LOGIN_TIMEOUT_MS,
  loginFailureMessage,
} from "./login-state";

const known = (id: string): id is ProviderId => isProvider(id);
function authStatusRow(id: ProviderId, name: string) {
  const st = active.get(activeKey(id));
  const cred = authStorage.get(id) as { enterpriseUrl?: string } | undefined;
  return {
    provider: id,
    name,
    configured: providerConnected(authStorage, id),
    enterpriseUrl: cred?.enterpriseUrl ?? null,
    login: st ? { status: st.status, info: st.info, error: st.error } : null,
  };
}

export async function getAuthStatus() {
  await refreshAnthropicCredential();
  const providers = PROVIDERS.map((p) => authStatusRow(p.id, p.name));
  const curated = new Set(PROVIDERS.map((p) => p.id));
  for (const id of piProviderIds()) {
    if (!curated.has(id) && providerConnected(authStorage, id))
      providers.push(authStatusRow(id, id));
  }
  return { providers, activeProvider: activeProvider() };
}

export {
  assertApiKeyConnectable,
  LOCAL_PLACEHOLDER_KEY,
  setApiKey,
  setCustomEndpoint,
} from "./login-keys";

/**
 * Whether any sign-in on this runtime still waits on its user, in any scope.
 * The host's idle probe reports it: a flow lives only in this process, so a
 * pod slept while one is pending drops the sign-in.
 */
export function loginPending(): boolean {
  for (const state of active.values()) {
    if (state.status === "starting" || state.status === "awaiting_user")
      return true;
  }
  return false;
}

/**
 * Cancel an in-flight OAuth login for real — not just the client's spinner.
 * Two teardown paths cover every flow pi runs:
 * - aborting the signal stops the device-code pollers (Codex device, Copilot);
 * - rejecting the paste promise unwinds the loopback flows (Anthropic, Codex
 *   browser): their onManualCodeInput rejection handler calls cancelWait(),
 *   which closes the callback server and frees the port for a retry.
 * Dropping the state from `active` immediately frees the slot, so a retried
 * startLogin never collides with the cancelled one ("sign-in already pending",
 * the HOU-438 failure class). Cancelling when nothing is in flight is benign.
 */
export function cancelLogin(providerId: string): void {
  if (!known(providerId)) throw new Error(`unknown provider: ${providerId}`);
  const key = activeKey(providerId);
  const state = active.get(key);
  if (!state || state.status === "complete") return;
  active.delete(key);
  clearLoginExpiry(state);
  state.abort?.abort();
  state.rejectPaste?.(new Error("login cancelled"));
}

/** Paste-code completion (Anthropic remote path). */
export function completeLogin(providerId: string, code: string): void {
  const state = active.get(activeKey(providerId as ProviderId));
  if (!state?.resolvePaste)
    throw new Error(`no active login for ${providerId}`);
  state.resolvePaste(code);
}

export async function logout(providerId: string): Promise<void> {
  if (!known(providerId)) throw new Error(`unknown provider: ${providerId}`);
  // Delete queues behind refresh's modify, so a late refresh cannot undo logout.
  await authStorage.delete(providerId);
  const key = activeKey(providerId);
  const state = active.get(key);
  if (state) clearLoginExpiry(state);
  active.delete(key);
  // The shared Claude dir is org material. A member's personal sign-out must
  // leave it alone, or that member would disconnect everyone in the space.
  // Org logout must clear the CLI credential and probe cache as well as auth.json.
  if (providerId === "anthropic") {
    if (isPersonalScope(currentCredentialScope().key))
      console.log(
        "[oauth:anthropic] personal disconnect: leaving the pod-shared Claude login dir (team credential) in place",
      );
    else await logoutAnthropicCredential();
  }
  // Forget the endpoint too, or resolution would keep a URL without its key.
  if (providerId === OPENAI_COMPATIBLE) clearCustomEndpointConfig();
}
