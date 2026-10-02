import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_SECRETS_FILE } from "./op-migrate-tree";
import type { OpRequest } from "./parse-op-request";
import { poolIdentity } from "./turn-store";

/** What the custody move did: secrets it moved, and whether custody now
 *  holds every one (only then is the plaintext file removed). */
export interface CustodyMove {
  moved: number;
  complete: boolean;
}

/**
 * The pod boot's custody move (RemoteCustomSecretStore.migrateLegacy) for a
 * hydrated store root: every plaintext custom-integration secret goes to the
 * gateway's custom-secret store, then the local file goes, so the sync-back
 * deletes the plaintext object. One difference: a value custody already
 * holds stays. Pool ops have written custody directly while this file sat in
 * the store, so the plaintext copy can be the older of the two.
 *
 * Each secret is CREATED (POST), which the gateway decides from its
 * transactional registry under the secret's lock, never from a vault read.
 * A refused create (412) counts only once a read finds the value; a gateway
 * that predates the create answers 405 and writes nothing. Either way the
 * file stays and the move is incomplete, for the next run.
 *
 * A failed request throws with the file still in place.
 */
export async function moveLegacySecrets(input: {
  storeRoot: string;
  op: Pick<OpRequest, "gcsPrefix" | "hostToken" | "claim">;
  fetchImpl?: typeof fetch;
}): Promise<CustodyMove> {
  const path = join(input.storeRoot, LEGACY_SECRETS_FILE);
  if (!existsSync(path)) return { moved: 0, complete: true };
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
  let complete = true;
  for (const [id, value] of Object.entries(
    new FileCustomSecretStore(path).entries(),
  )) {
    // The read spares a create for a value custody holds.
    if ((await custody.get(id)) !== null) continue;
    const url = `${baseUrl}/v1/pod/custom-secrets/${encodeURIComponent(org)}/${encodeURIComponent(agent)}/${encodeURIComponent(id)}`;
    const created = await create(fetchImpl, url, input.op.hostToken, id, value);
    if (created === "created") moved++;
    else if (created === "unsupported" || (await custody.get(id)) === null)
      complete = false;
  }
  if (complete) rmSync(path);
  return { moved, complete };
}

async function create(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  id: string,
  value: string,
): Promise<"created" | "exists" | "unsupported"> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ value }),
  });
  await response.body?.cancel();
  if (response.status === 412) return "exists";
  if (response.status === 405) return "unsupported";
  if (!response.ok)
    throw new Error(`custom secret create ${id} failed (${response.status})`);
  return "created";
}
