import {
  AZURE_OPENAI,
  normalizeAzureEndpoint,
  setAzureEndpoint,
} from "../ai/azure-openai";
import {
  type CustomEndpointInput,
  clearCustomEndpointConfig,
  OPENAI_COMPATIBLE,
  setCustomEndpointConfig,
} from "../ai/openai-compatible";
import { piProviderIds } from "../ai/pi-catalog";
import {
  activeProvider,
  isProvider,
  PROVIDERS,
  type ProviderId,
  providerAuthMethod,
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

export function setApiKey(
  providerId: string,
  key: string,
  endpoint?: string,
): void {
  const trimmed = assertApiKeyConnectable(providerId, key, endpoint);
  if (providerId === AZURE_OPENAI) setAzureEndpoint(endpoint ?? "");
  authStorage.set(providerId, { type: "api_key", key: trimmed });
  const slot = activeKey(providerId as ProviderId);
  const state = active.get(slot);
  if (state) clearLoginExpiry(state);
  active.delete(slot);
}

export function assertApiKeyConnectable(
  providerId: string,
  key: string,
  endpoint?: string,
) {
  if (!known(providerId)) throw new Error(`unknown provider: ${providerId}`);
  if (providerAuthMethod(providerId) !== "apiKey")
    throw new Error(`${providerId} does not connect with a pasted API key`);
  const trimmed = key.trim();
  if (!trimmed) throw new Error("missing API key");
  if (providerId === AZURE_OPENAI) normalizeAzureEndpoint(endpoint ?? "");
  return trimmed;
}

export const LOCAL_PLACEHOLDER_KEY = "houston-local";

export function setCustomEndpoint(
  input: CustomEndpointInput & { apiKey?: string },
): void {
  setCustomEndpointConfig(input);
  const key = input.apiKey?.trim() || LOCAL_PLACEHOLDER_KEY;
  authStorage.set(OPENAI_COMPATIBLE, { type: "api_key", key });
}

export function loginPending(): boolean {
  for (const state of active.values()) {
    if (state.status === "starting" || state.status === "awaiting_user")
      return true;
  }
  return false;
}

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

export function completeLogin(providerId: string, code: string): void {
  const state = active.get(activeKey(providerId as ProviderId));
  if (!state?.resolvePaste)
    throw new Error(`no active login for ${providerId}`);
  state.resolvePaste(code);
}

export async function logout(providerId: string): Promise<void> {
  if (!known(providerId)) throw new Error(`unknown provider: ${providerId}`);
  await authStorage.delete(providerId);
  const key = activeKey(providerId);
  const state = active.get(key);
  if (state) clearLoginExpiry(state);
  active.delete(key);
  if (providerId === "anthropic") {
    if (isPersonalScope(currentCredentialScope().key))
      console.log(
        "[oauth:anthropic] personal disconnect: leaving the pod-shared Claude login dir (team credential) in place",
      );
    else await logoutAnthropicCredential();
  }
  if (providerId === OPENAI_COMPATIBLE) clearCustomEndpointConfig();
}
