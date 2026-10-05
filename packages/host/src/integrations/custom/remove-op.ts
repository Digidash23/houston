import type { CustomOAuthDeps } from "./oauth-ops";
import type { CustomIntegrationDef } from "./types";

export async function removeCustomIntegration(
  deps: CustomOAuthDeps,
  def: CustomIntegrationDef,
): Promise<void> {
  await deps.store.remove(def.slug);
  for (const id of Object.values(def.credential?.secretIds ?? {})) {
    await deps.secrets.delete(id);
  }
  const { executor, states } = await deps.host.ensure();
  states.delete(def.slug);
  if (def.kind === "openapi") {
    await executor.openapi.removeSpec(def.slug).catch(() => undefined);
  } else {
    await executor.mcp.removeServer(def.slug).catch(() => undefined);
  }
  deps.onChanged(def.slug);
}
