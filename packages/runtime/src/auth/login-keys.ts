import {
  AZURE_OPENAI,
  normalizeAzureEndpoint,
  setAzureEndpoint,
} from "../ai/azure-openai";
import {
  type CustomEndpointInput,
  OPENAI_COMPATIBLE,
  setCustomEndpointConfig,
} from "../ai/openai-compatible";
import {
  isProvider,
  type ProviderId,
  providerAuthMethod,
} from "../ai/providers";
import { active, activeKey, clearLoginExpiry } from "./login-state";
import { authStorage } from "./storage";

const known = (id: string): id is ProviderId => isProvider(id);

/**
 * Store a pasted API key for an api-key provider. The store persists it as
 * pi's `api_key` credential variant; auth resolution then returns it for any
 * request against the provider's built-in OpenAI-compatible gateway. There is
 * no OAuth dance and nothing to refresh or scrub.
 *
 * Azure OpenAI (PRODUCT-1477) additionally requires the resource `endpoint`,
 * persisted FIRST (its own file, ai/azure-openai.ts) so a bad URL never
 * leaves a stored key aimed at nothing — mirroring setCustomEndpoint's order.
 */
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

/**
 * The cheap, offline preconditions of an API-key connect (known provider,
 * api-key auth method, non-empty key) — split out so the connect route can
 * fail fast on these BEFORE spending a live verification request
 * (`verifyApiKey`). Returns the trimmed key.
 */
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

/**
 * Placeholder key for keyless local servers. Ollama / LM Studio / vLLM ignore
 * the Authorization header, but pi requires SOME key to resolve a request (it
 * throws "No API key for provider" otherwise), so a blank key becomes this.
 */
export const LOCAL_PLACEHOLDER_KEY = "houston-local";

/**
 * Connect an OpenAI-compatible (local) server: persist its base URL + model (and
 * display options) and store the optional key in auth.json — a placeholder when
 * the server is keyless. LOCAL profile only; the host gates this on its
 * capability, never serving it from a cloud runtime that can't reach localhost.
 */
export function setCustomEndpoint(
  input: CustomEndpointInput & { apiKey?: string },
): void {
  setCustomEndpointConfig(input);
  const key = input.apiKey?.trim() || LOCAL_PLACEHOLDER_KEY;
  authStorage.set(OPENAI_COMPATIBLE, { type: "api_key", key });
}
