import { join } from "node:path";
import type { CustomIntegrationManager } from "@houston/host/src/integrations/custom/manager";
import { preloadCustomIntegrationModules } from "./custom-integration-loader";
import type { OpRequest } from "./parse-op-request";
import type { TurnFilesystem } from "./turn-filesystem";
import { poolIdentity } from "./turn-store";

/** The store-root definitions file custom-integration ops read and write. */
export const CUSTOM_DEFS_FILE = "custom-integrations.json";

export interface CustomContext {
  manager: CustomIntegrationManager;
  changed: () => boolean;
  dispose: () => Promise<void>;
}

/**
 * A per-op custom-integration manager for a route op on a pool worker:
 * definitions at the store root, secrets in the gateway's custom-secret
 * store, a fresh in-memory executor. The pod's own construction minus OAuth
 * sign-in, whose pending state lives only in a pod's memory.
 */
export async function customIntegrationContext(
  op: Pick<OpRequest, "gcsPrefix" | "hostToken" | "claim">,
  filesystem: TurnFilesystem,
  fetchImpl?: typeof fetch,
): Promise<CustomContext> {
  // Materialize the store-root definitions file into the lazy overlay (and
  // its manifest) BEFORE the raw-fs store reads it: an unmaterialized file
  // would read as "no definitions" and a later write would CAS-create over
  // the real one.
  await filesystem.vfs.readBytes(CUSTOM_DEFS_FILE);
  // Imported lazily: the embedded executor engine is heavy, and only the
  // rare custom-integration op needs it — worker startup must not pay it.
  const [
    { CustomExecutorHost },
    { CustomIntegrationManager },
    ,
    { RemoteCustomSecretStore },
    { FileCustomIntegrationStore },
  ] = await preloadCustomIntegrationModules();
  const { org, agent } = poolIdentity(op.gcsPrefix);
  const store = new FileCustomIntegrationStore(
    join(filesystem.storeRoot, CUSTOM_DEFS_FILE),
  );
  const secrets = new RemoteCustomSecretStore({
    baseUrl: new URL(op.claim.heartbeatUrl).origin,
    orgSlug: org,
    agentSlug: agent,
    podToken: op.hostToken,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const executor = new CustomExecutorHost(secrets, () => store.list());
  let changed = false;
  const manager = new CustomIntegrationManager(
    store,
    secrets,
    executor,
    () => {
      changed = true;
    },
    // No OAuth options: sign-in never runs here (see the module doc).
    {},
  );
  return {
    manager,
    changed: () => changed,
    dispose: () => executor.reset(),
  };
}
