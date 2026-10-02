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
 * the store, so the plaintext copy can be the older of the two. The write is
 * create-only (`If-None-Match: *`): the gateway checks and writes under the
 * secret's write lock, so a value another writer sets after the read here
 * stays too. The bearer is the op's claim-bound turn token.
 *
 * A failed read or write throws with the file still in place: the next run
 * retries. Answers how many secrets moved.
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
  const baseUrl = new URL(input.op.claim.heartbeatUrl).origin;
  const fetchImpl = input.fetchImpl ?? fetch;
  const custody = new RemoteCustomSecretStore({
    baseUrl,
    orgSlug: org,
    agentSlug: agent,
    podToken: input.op.hostToken,
    fetchImpl,
    cacheTtlMs: 0,
  });
  let moved = 0;
  for (const [id, value] of Object.entries(
    new FileCustomSecretStore(path).entries(),
  )) {
    // The read spares a write for a value custody holds; the create-only
    // write is what keeps one that lands in between.
    if ((await custody.get(id)) !== null) continue;
    const url = `${baseUrl}/v1/pod/custom-secrets/${encodeURIComponent(org)}/${encodeURIComponent(agent)}/${encodeURIComponent(id)}`;
    if (await createIfAbsent(fetchImpl, url, input.op.hostToken, id, value))
      moved++;
  }
  rmSync(path);
  return moved;
}

async function createIfAbsent(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  id: string,
  value: string,
): Promise<boolean> {
  const response = await fetchImpl(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "If-None-Match": "*",
    },
    body: JSON.stringify({ value }),
  });
  await response.body?.cancel();
  if (response.status === 412) return false;
  if (!response.ok)
    throw new Error(
      `custom secret create-only PUT ${id} failed (${response.status})`,
    );
  return true;
}
