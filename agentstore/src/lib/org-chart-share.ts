/**
 * A shared org chart picture, read from the gateway's public
 * `GET /v1/org-chart-shares/{id}` for the `/o/[id]` page and its share card.
 *
 * SERVER ONLY: reads the private `AGENTSTORE_GATEWAY_URL`, sends no
 * credentials. A share never changes once published, so a read is cached
 * for an hour.
 */
import { serverGatewayBase } from "./store-api-types";

export interface OrgChartShare {
  id: string;
  title: string;
  imageUrl: string;
  createdAt: string;
}

/** 22 base64url characters: what the gateway mints. */
const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;

const REVALIDATE_SECONDS = 3600;

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

/**
 * The share `id` names, or null when there is none (an id the gateway could
 * never have minted is not asked about). Any other failure throws.
 */
export async function getOrgChartShare(
  id: string,
): Promise<OrgChartShare | null> {
  if (!isOrgChartShareId(id)) return null;
  const res = await fetch(`${serverGatewayBase()}/v1/org-chart-shares/${id}`, {
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(`org chart share ${id}: gateway answered ${res.status}`);
  const share = parseOrgChartShare(await res.json());
  if (!share) throw new Error(`org chart share ${id}: unreadable record`);
  return share;
}
