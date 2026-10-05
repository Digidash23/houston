/**
 * Moving pre-custody plaintext custom-integration secrets into the gateway's
 * custody, shared by a managed pod's boot (RemoteCustomSecretStore
 * .migrateLegacy) and a pool worker's store migration (runtime
 * op-migrate-custody.ts). A value custody already holds always stays: pool
 * ops have written custody while the plaintext file sat in the store, so the
 * plaintext copy can be the older of the two.
 */

/** A create's answer: written, refused over a value (412), or a gateway
 *  that predates creates (405, nothing written). */
export type CustodyCreate = "created" | "exists" | "unsupported";

export interface LegacyCustodyResult {
  moved: number;
  /** Custody holds every value: only then may the plaintext file go. */
  complete: boolean;
}

/**
 * Each absent secret is CREATED, which the gateway decides under the
 * secret's lock from consistent writes, never from a read that may lag. A
 * refused create counts only once a read finds the value. A failed request
 * throws.
 */
export async function moveLegacyToCustody(
  entries: Record<string, string>,
  custody: {
    /** A read that skips any cache. */
    get: (id: string) => Promise<string | null>;
    create: (id: string, value: string) => Promise<CustodyCreate>;
  },
): Promise<LegacyCustodyResult> {
  let moved = 0;
  let complete = true;
  for (const [id, value] of Object.entries(entries)) {
    if ((await custody.get(id)) !== null) continue;
    const created = await custody.create(id, value);
    if (created === "created") moved++;
    else if (created === "unsupported" || (await custody.get(id)) === null)
      complete = false;
  }
  return { moved, complete };
}

/** POST one secret to the custody route (`url` names it). */
export async function createCustomSecret(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  id: string,
  value: string,
): Promise<CustodyCreate> {
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
