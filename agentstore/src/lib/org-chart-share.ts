/**
 * A shared org chart picture, read from the gateway's public
 * `GET /v1/org-chart-shares/{id}` (and `/image`) for the `/o/[id]` page and
 * its share card.
 *
 * SERVER ONLY: reads go to the in-cluster `AGENTSTORE_GATEWAY_URL` and send no
 * credentials. A share never changes once published, so a read is cached for
 * an hour. Nothing here throws: a slow, refused (the gateway caps public reads
 * per IP, and every store render comes from one) or failed read answers
 * `unavailable`, and the page still renders off the id alone, because the
 * picture's address is derived from it. Only the gateway's 404 means the
 * share does not exist.
 */
import { clientGatewayBase, serverGatewayBase } from "./store-api-types";

export interface OrgChartShare {
  id: string;
  title: string;
  imageUrl: string;
  createdAt: string;
}

export type OrgChartShareLookup =
  | { kind: "found"; share: OrgChartShare }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export type OrgChartImageLookup =
  | { kind: "found"; dataUrl: string }
  | { kind: "not_found" }
  | { kind: "unavailable" };

/** 22 base64url characters: what the gateway mints. */
const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;

const REVALIDATE_SECONDS = 3600;

/** How long a render waits on the gateway before it goes without. */
export const ORG_CHART_FETCH_TIMEOUT_MS = 4000;

export function isOrgChartShareId(id: string): boolean {
  return SHARE_ID.test(id);
}

const imagePath = (id: string) => `/v1/org-chart-shares/${id}/image`;

/** The picture's public address, for a browser's `<img>`. */
export function publicOrgChartImageUrl(id: string): string {
  return `${clientGatewayBase()}${imagePath(id)}`;
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
  const { id, title, imageUrl, createdAt } = value as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    !isOrgChartShareId(id) ||
    typeof title !== "string" ||
    !title.trim() ||
    !isWebUrl(imageUrl) ||
    typeof createdAt !== "string"
  )
    return null;
  return { id, title, imageUrl, createdAt };
}

/** One cached, time-boxed gateway read; `null` when no answer came back. */
async function gatewayGet(path: string): Promise<Response | null> {
  try {
    return await fetch(`${serverGatewayBase()}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(ORG_CHART_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`agentstore: org chart share ${path} unreachable`, err);
    return null;
  }
}

function unavailable(path: string, why: string): { kind: "unavailable" } {
  console.warn(`agentstore: org chart share ${path}: ${why}`);
  return { kind: "unavailable" };
}

/** The share `id` names. An id the gateway could never have minted is not asked about. */
export async function getOrgChartShare(
  id: string,
): Promise<OrgChartShareLookup> {
  if (!isOrgChartShareId(id)) return { kind: "not_found" };
  const path = `/v1/org-chart-shares/${id}`;
  const res = await gatewayGet(path);
  if (!res) return { kind: "unavailable" };
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return unavailable(path, `gateway answered ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return unavailable(path, `unreadable body: ${String(err)}`);
  }
  const share = parseOrgChartShare(body);
  return share ? { kind: "found", share } : unavailable(path, "unreadable");
}

/** The share's picture as a data URL, so a card render never refetches it. */
export async function getOrgChartImage(
  id: string,
): Promise<OrgChartImageLookup> {
  if (!isOrgChartShareId(id)) return { kind: "not_found" };
  const path = imagePath(id);
  const res = await gatewayGet(path);
  if (!res) return { kind: "unavailable" };
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return unavailable(path, `gateway answered ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (type !== "image/png" && type !== "image/jpeg")
    return unavailable(path, `not a picture (${type})`);
  try {
    const bytes = Buffer.from(await res.arrayBuffer());
    return {
      kind: "found",
      dataUrl: `data:${type};base64,${bytes.toString("base64")}`,
    };
  } catch (err) {
    return unavailable(path, `body cut short: ${String(err)}`);
  }
}

/** What the `/o/[id]` page shows: the share, or the id's picture under a plain title. */
export interface OrgChartPageView {
  title: string;
  imageUrl: string;
  /** The record could not be read, so the title is the plain one. */
  generic: boolean;
}

/** The page's title when the record could not be read. */
export const ORG_CHART_GENERIC_TITLE = "An AI team on Houston";

export function orgChartPageView(
  id: string,
  lookup: OrgChartShareLookup,
): OrgChartPageView | null {
  if (lookup.kind === "not_found") return null;
  if (lookup.kind === "found")
    return {
      title: lookup.share.title,
      imageUrl: lookup.share.imageUrl,
      generic: false,
    };
  return {
    title: ORG_CHART_GENERIC_TITLE,
    imageUrl: publicOrgChartImageUrl(id),
    generic: true,
  };
}
