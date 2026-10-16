/**
 * A shared org chart, read from the gateway's public
 * `GET /v1/org-chart-shares/{id}` for the `/o/[id]` page and its link preview.
 *
 * SERVER ONLY: reads go to the in-cluster `AGENTSTORE_GATEWAY_URL` and send no
 * credentials. The record is read fresh on every render (`no-store`): Next's
 * data cache would keep serving a 200 after a purge, because an upstream 404
 * never replaces a cached 200. The gateway's own `Cache-Control` covers HTTP
 * caches in front of the page. LinkedIn keeps a post's preview from the
 * moment it is posted, so a record that cannot be read is never papered over
 * with a generic page: one failed read is asked again, and a second throws,
 * so the page answers 5xx and the composer shows no card (which the person
 * sees before posting) instead of a wrong one pinned to the post for good.
 * Only the gateway's 404 means the share does not exist.
 */
import { serverGatewayBase } from "./store-api-types";

/** What the page says about a chart. Plain English, like the rest of the site. */
export const ORG_CHART_TAGLINE = "AI Employees working in Houston";

export interface OrgChartShare {
  id: string;
  title: string;
  /** The square chart, 1200 x 1200. */
  imageUrl: string;
  /** The 1200 x 630 link card; null when none was uploaded. */
  previewUrl: string | null;
  createdAt: string;
}

export type OrgChartShareLookup =
  | { kind: "found"; share: OrgChartShare }
  | { kind: "not_found" }
  | { kind: "unavailable" };

/** 22 base64url characters: what the gateway mints. */
const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;

/** How long a render waits on the gateway before it counts the read as failed. */
export const ORG_CHART_FETCH_TIMEOUT_MS = 4000;

export class OrgChartUnavailableError extends Error {
  override name = "OrgChartUnavailableError";
}

export function isOrgChartShareId(id: string): boolean {
  return SHARE_ID.test(id);
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The record the gateway answered, or null when it is not one. */
export function parseOrgChartShare(value: unknown): OrgChartShare | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, title, imageUrl, previewUrl, createdAt } = value as Record<
    string,
    unknown
  >;
  if (
    typeof id !== "string" ||
    !isOrgChartShareId(id) ||
    typeof title !== "string" ||
    !title.trim() ||
    !isWebUrl(imageUrl) ||
    // The gateway omits an absent card; a `null` is read as absent too.
    (previewUrl != null && !isWebUrl(previewUrl)) ||
    typeof createdAt !== "string"
  )
    return null;
  return { id, title, imageUrl, previewUrl: previewUrl ?? null, createdAt };
}

function unavailable(path: string, why: string): { kind: "unavailable" } {
  console.warn(`agentstore: org chart share ${path}: ${why}`);
  return { kind: "unavailable" };
}

/** One time-boxed read of the record `id` names. Never throws. */
async function readOnce(id: string): Promise<OrgChartShareLookup> {
  const path = `/v1/org-chart-shares/${id}`;
  let res: Response;
  try {
    res = await fetch(`${serverGatewayBase()}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(ORG_CHART_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return unavailable(path, `unreachable: ${String(err)}`);
  }
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return unavailable(path, `gateway answered ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return unavailable(path, `unreadable body: ${String(err)}`);
  }
  const share = parseOrgChartShare(body);
  if (!share) return unavailable(path, "unreadable record");
  // A record for another share (a cache keyed wrong, a gateway bug) would put
  // someone else's chart under this link.
  if (share.id !== id) return unavailable(path, `answered for ${share.id}`);
  return { kind: "found", share };
}

/**
 * The share `id` names, asked twice before it counts as unavailable. An id
 * the gateway could never have minted is not asked about.
 */
export async function getOrgChartShare(
  id: string,
): Promise<OrgChartShareLookup> {
  if (!isOrgChartShareId(id)) return { kind: "not_found" };
  const first = await readOnce(id);
  return first.kind === "unavailable" ? readOnce(id) : first;
}

/**
 * The share the page shows, null for one that does not exist; throws when
 * the record could not be read, so the page answers 5xx.
 */
export function orgChartPageShare(
  id: string,
  lookup: OrgChartShareLookup,
): OrgChartShare | null {
  if (lookup.kind === "found") return lookup.share;
  if (lookup.kind === "not_found") return null;
  throw new OrgChartUnavailableError(`org chart share ${id} is unavailable`);
}

/** The picture a link to the page previews with: the card, else the chart. */
export function orgChartPreviewImage(share: OrgChartShare) {
  const alt = `${share.title}: ${ORG_CHART_TAGLINE}`;
  return share.previewUrl
    ? { url: share.previewUrl, width: 1200, height: 630, alt }
    : { url: share.imageUrl, width: 1200, height: 1200, alt };
}
