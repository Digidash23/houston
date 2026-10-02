import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_SECRETS_FILE } from "./op-migrate-tree";
import type { OpRequest } from "./parse-op-request";
import { poolIdentity } from "./turn-store";

/**
 * The pod boot's custody move (RemoteCustomSecretStore.migrateLegacy) for a
 * hydrated store root: every plaintext custom-integration secret goes to the
 * gateway's custom-secret store, then the local file goes, so the sync-back
 * deletes the plaintext object. One difference: a value custody already
 * holds stays. Pool ops have written custody directly while this file sat in
 * the store, so the plaintext copy can be the older of the two. A failed
 * read or write throws with the file still in place: the next run retries.
 * Answers how many secrets moved.
 */
export async function moveLegacySecrets(input: {
  storeRoot: string;
  op: Pick<OpRequest, "gcsPrefix" | "hostToken" | "claim">;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const path = join(input.storeRoot, LEGACY_SECRETS_FILE);
  if (!existsSync(path)) return 0;
  // Imported only here: the module pulls the integration engine's runtime,
  // which no other migration step needs.
  const { FileCustomSecretStore, RemoteCustomSecretStore } = await import(
    "@houston/host/src/integrations/custom/secrets"
  );
  const { org, agent } = poolIdentity(input.op.gcsPrefix);
  const custody = new RemoteCustomSecretStore({
    baseUrl: new URL(input.op.claim.heartbeatUrl).origin,
    orgSlug: org,
    agentSlug: agent,
    podToken: input.op.hostToken,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    cacheTtlMs: 0,
  });
  let moved = 0;
  for (const [id, value] of Object.entries(
    new FileCustomSecretStore(path).entries(),
  )) {
    if ((await custody.get(id)) !== null) continue;
    await custody.set(id, value);
    moved++;
  }
  rmSync(path);
  return moved;
}
