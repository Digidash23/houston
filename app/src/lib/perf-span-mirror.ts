import type { Capabilities, OrgsList } from "@houston/engine-adapter";
import { activeSpaceOrgSlug } from "@houston/sdk";
import { hasSpaces } from "./org-roles.ts";
import type { PerfSpanName } from "./perf-spans.ts";
import { orgSlugFromWorkspaceId } from "./space-id.ts";

/**
 * What the PostHog mirror of a perf span carries (`perf_span`). The org slug is
 * here so the E2B canary can compare served and unserved orgs on the one TTFT
 * both arms measure the same way; the gateway's Prometheus ingest never gets
 * it (see `perf-spans.ts`).
 */

/**
 * The org slug perf spans are tagged with: the same slug the gateway's per-org
 * switches key on (`GW_POOL_SERVE_ORGS`). Only a deployment that advertises
 * spaces has orgs, so desktop and self-host answer null even for a local
 * workspace named like a team. So does the gateway while its capabilities
 * refetch after a space switch, and a personal space until its memberships
 * have been read: those sends go untagged rather than guessed.
 */
export function perfSpanOrgSlug(
  capabilities: Capabilities | null,
  workspaceId: string | undefined,
  orgs: OrgsList | undefined,
): string | null {
  if (!hasSpaces(capabilities)) return null;
  const team = workspaceId ? orgSlugFromWorkspaceId(workspaceId) : null;
  return activeSpaceOrgSlug(team, orgs);
}

/**
 * Whether naming the org needs the memberships list: only a settled hosted
 * personal space does, since a team carries its slug in its workspace id.
 */
export function perfSpanNeedsMemberships(
  capabilities: Capabilities | null,
  workspaceId: string | undefined,
): boolean {
  return (
    hasSpaces(capabilities) &&
    workspaceId !== undefined &&
    orgSlugFromWorkspaceId(workspaceId) === null
  );
}

export interface PerfSpanEventProps {
  span: PerfSpanName;
  duration_ms: number;
  org_slug?: string;
}

/** The `perf_span` properties. No org means no `org_slug` key at all. */
export function perfSpanEventProps(
  span: PerfSpanName,
  ms: number,
  orgSlug: string | null,
): PerfSpanEventProps {
  return orgSlug
    ? { span, duration_ms: ms, org_slug: orgSlug }
    : { span, duration_ms: ms };
}
