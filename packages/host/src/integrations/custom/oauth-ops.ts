import type { CustomExecutorHost } from "./executor-host";
import { TOKEN_VARIABLE } from "./executor-host";
import { parseBundle } from "./oauth-bundle";
import {
  beginCustomOAuth,
  type CustomOAuthAttempt,
  type CustomOAuthAttempts,
  settleCustomOAuth,
} from "./oauth-flow";
import { type CustomSecretStore, secretIdFor } from "./secrets";
import type { CustomIntegrationStore } from "./store";
import type { CustomIntegrationDef, CustomIntegrationView } from "./types";
import { CustomIntegrationError } from "./types";
import { viewOf } from "./views";

/**
 * The manager-side OAuth operations (PRODUCT-1172), split out so the manager
 * stays a thin serializer. Preparation leaves attempt custody to the caller;
 * completion exchanges the callback's code, persists the token bundle under the
 * SAME secret id a pasted key would use, and rewires the connection through
 * the proven setCredential sequence.
 */
export interface CustomOAuthDeps {
  store: CustomIntegrationStore;
  secrets: CustomSecretStore;
  host: CustomExecutorHost;
  attempts: CustomOAuthAttempts;
  /** The browser-reachable callback URL; absent = this deployment cannot
   *  receive the redirect. */
  callbackUrl?: string;
  /** Gateway-fronted hosts and workers bind state to `<orgSlug>.<agentSlug>`. */
  statePrefix?: string;
  fetchFn?: typeof fetch;
  onChanged: (slug: string) => void;
}

export async function prepareOAuthOp(
  deps: CustomOAuthDeps,
  def: CustomIntegrationDef,
): Promise<{
  authorizeUrl: string;
  state: string;
  attempt: CustomOAuthAttempt;
}> {
  if (!deps.callbackUrl) {
    throw new CustomIntegrationError(
      "oauth_unsupported",
      "signing in with this service is not available on this Houston deployment yet",
    );
  }
  if (def.kind !== "mcp") {
    throw new CustomIntegrationError(
      "oauth_unsupported",
      `'${def.slug}' is not an MCP server - only MCP servers offer their own sign-in`,
    );
  }
  // The stored bundle is only an OPTIMIZATION here (reuse the registered
  // client on a re-auth) — a custody hiccup must not kill the START; the
  // flow simply registers fresh. Completion still fails loudly if the store
  // cannot take the tokens.
  const raw = await deps.secrets
    .get(secretIdFor(def.slug, TOKEN_VARIABLE))
    .catch(() => null);
  const existing = raw ? parseBundle(raw) : null;
  const { state, authorizeUrl, attempt } = await beginCustomOAuth(
    def,
    deps.callbackUrl,
    existing,
    {
      ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
      ...(deps.statePrefix ? { statePrefix: deps.statePrefix } : {}),
    },
  );
  return { authorizeUrl, state, attempt };
}

export async function startOAuthOp(
  deps: CustomOAuthDeps,
  def: CustomIntegrationDef,
): Promise<{ authorizeUrl: string }> {
  const { authorizeUrl, state, attempt } = await prepareOAuthOp(deps, def);
  deps.attempts.put(state, attempt);
  return { authorizeUrl };
}

export async function completeOAuthOp(
  deps: CustomOAuthDeps,
  defOf: (slug: string) => Promise<CustomIntegrationDef>,
  state: string,
  code: string,
): Promise<CustomIntegrationView> {
  const attempt = deps.attempts.take(state);
  if (!attempt) {
    throw new CustomIntegrationError(
      "oauth_state_invalid",
      "this sign-in link has expired or was already used - start again from the integration's card",
    );
  }
  return completeOAuthWithAttempt(deps, defOf, attempt, code);
}

export async function completeOAuthWithAttempt(
  deps: CustomOAuthDeps,
  defOf: (slug: string) => Promise<CustomIntegrationDef>,
  attempt: CustomOAuthAttempt,
  code: string,
): Promise<CustomIntegrationView> {
  const def = await defOf(attempt.slug);
  // The attempt binds to the SERVICE, not just the slug: a replace that moved
  // the slug to a different endpoint mid-flow must not receive the old
  // service's tokens (the executor would then send them to the new host).
  if (def.kind !== "mcp" || def.endpoint !== attempt.endpoint) {
    throw new CustomIntegrationError(
      "oauth_state_invalid",
      "this integration changed while the sign-in was in progress - start again from its card",
    );
  }
  const bundle = await settleCustomOAuth(attempt, code, deps.fetchFn);
  const { executor, states } = await deps.host.ensure();
  const methods = await deps.host.authMethods(executor, def.slug);
  const template = methods[0]?.template;
  if (!template) {
    const live = states.get(def.slug);
    throw new CustomIntegrationError(
      "oauth_failed",
      live?.status === "error"
        ? `'${def.slug}' is not working right now (${live.message})`
        : `'${def.slug}' has no way to carry the sign-in token`,
    );
  }
  const secretId = secretIdFor(def.slug, TOKEN_VARIABLE);
  await deps.secrets.set(secretId, JSON.stringify(bundle));
  const credential = { template, secretIds: { [TOKEN_VARIABLE]: secretId } };
  const updated: CustomIntegrationDef = { ...def, auth: "oauth", credential };
  await deps.store.put(updated);
  await deps.host.reconnect(executor, def.slug, credential);
  // The SAME zero-tool judge the compile path uses: a sign-in whose fresh
  // token the server still turns away must land pending/error, not celebrate
  // as "Connected, 0 actions".
  const liveState = await deps.host.connectedState(executor, updated);
  states.set(def.slug, liveState);
  deps.onChanged(def.slug);
  return viewOf(updated, liveState, methods);
}
