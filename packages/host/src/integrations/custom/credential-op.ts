import { TOKEN_VARIABLE } from "./executor-host";
import type { CustomOAuthDeps } from "./oauth-ops";
import { secretIdFor } from "./secrets";
import {
  type CustomIntegrationDef,
  CustomIntegrationError,
  type CustomIntegrationView,
} from "./types";
import { viewOf } from "./views";

export async function setCustomCredential(
  deps: CustomOAuthDeps,
  def: CustomIntegrationDef,
  values: Record<string, string>,
): Promise<CustomIntegrationView> {
  const slug = def.slug;
  const { executor, states } = await deps.host.ensure();
  // Providing a key IS declaring the service needs one: heal an OpenAPI def
  // with no collectible method (spec without a security scheme) instead of
  // dead-ending the save — covers defs added as `auth: "none"` too, which
  // compileDef's own ensure call never sees.
  await deps.host.ensureCollectibleAuth(executor, def);
  const methods = await deps.host.authMethods(executor, slug);
  const method = methods[0];
  if (!method) {
    const state = states.get(slug);
    throw new CustomIntegrationError(
      "credential_invalid",
      state?.status === "error"
        ? `'${slug}' is not working right now (${state.message}), so the key cannot be saved. Fix or re-add the integration first.`
        : `'${slug}' does not say where an API key goes. Remove it and add it again as a service that needs a key.`,
    );
  }
  const token = values[TOKEN_VARIABLE] ?? Object.values(values)[0];
  if (!token?.trim()) {
    throw new CustomIntegrationError(
      "credential_invalid",
      "the credential value is empty",
    );
  }
  // Key-first validation is ADVISORY, never a gate: the declared placement
  // is a per-service guess (an MCP server may want a different header than
  // the standard Bearer), so a failed probe with a REAL key would otherwise
  // hard-block saving with no path forward. The verdict rides the returned
  // view as `verified` so the UI picks confirmation vs warning copy; a
  // genuinely bad key still surfaces on first use, where the execute
  // failure carries the request_credential recovery hint.
  const verdict = await executor.connections
    .validate({
      owner: "org",
      integration: slug,
      template: method.template,
      values: { [TOKEN_VARIABLE]: token },
    })
    .catch(() => null);
  const verified =
    verdict?.status === "healthy"
      ? true
      : verdict?.status === "expired" || verdict?.status === "degraded"
        ? false
        : undefined;

  const secretId = secretIdFor(slug, TOKEN_VARIABLE);
  await deps.secrets.set(secretId, token);
  const credential = {
    template: method.template,
    secretIds: { [TOKEN_VARIABLE]: secretId },
  };
  const updated: CustomIntegrationDef = {
    ...def,
    auth: "credential",
    credential,
  };
  await deps.store.put(updated);
  await deps.host.reconnect(executor, slug, credential);
  const state = {
    status: "active" as const,
    toolCount: await deps.host.toolCount(executor, slug),
  };
  states.set(slug, state);
  deps.onChanged(slug);
  return {
    ...viewOf(updated, state, methods),
    ...(verified !== undefined ? { verified } : {}),
  };
}
