import { storeWriteHeaders } from "./http-store-write-headers";

/**
 * The pod-store's verdict on this boot's write lease: `held` while a write
 * would be accepted, `fenced` once another boot owns the agent's prefix,
 * `unsupported` from a pod-store that predates the check route.
 */
export type WriteLeaseVerdict = "held" | "fenced" | "unsupported";

export interface WriteLeaseProbeOptions {
  /** The agent-scoped base URL, `/v1/pod/store/<org>/<agent>`. */
  baseUrl: string;
  token: string;
  bootId: string;
  /** The SAME mutable lease token the boot's store writes present. */
  fence: { token?: string };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// Every agent-data write waits on this ask; a slow store must not stall them.
const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * Ask `GET <agent>/lease` whether a write carrying this boot's fencing headers
 * would be accepted right now. The store sync meets a takeover only when it
 * has something to upload, so an idle pod fenced by a newer boot learns it
 * here, before it acknowledges a write it could never persist. Sends exactly
 * the headers a write would (none before a lease was claimed), so the answer
 * is the write's own verdict. Throws on transport failure or any other status:
 * the caller decides how an unreachable store is treated.
 */
export function createWriteLeaseProbe(
  opts: WriteLeaseProbeOptions,
): () => Promise<WriteLeaseVerdict> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/lease`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async () => {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: storeWriteHeaders(
        { Authorization: `Bearer ${opts.token}` },
        undefined,
        { bootId: opts.bootId, fence: opts.fence, claim: undefined },
      ),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    // Release the (tiny) body so the keep-alive socket is reusable.
    await res.body?.cancel();
    if (res.status === 204 || res.ok) return "held";
    if (res.status === 409) return "fenced";
    // The route is GET-only on a new pod-store; an old one has only the POST
    // mint at this path (405) or nothing at all (404).
    if (res.status === 404 || res.status === 405) return "unsupported";
    throw new Error(`write lease check failed (${res.status})`);
  };
}
