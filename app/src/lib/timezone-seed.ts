import { orgSlugFromWorkspaceId } from "./space-id";

/**
 * The inputs the app hands the SDK's timezone seed
 * (`@houston/sdk` preferences `seedTimezone`, which owns the rule).
 */

/** The device's IANA zone, `UTC` when the runtime cannot say. */
export function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz?.length) return tz;
  } catch {
    // An Intl without zone data: UTC is the only safe answer.
  }
  return "UTC";
}

/**
 * The seed scope: one person in one space (the gateway keys preferences by
 * org and user), or null until both are known. A deployment with no identity
 * (local, self-host) has exactly one person.
 */
export function timezoneOwner(
  uid: string | null,
  identityConfigured: boolean,
  workspaceId: string | null,
): string | null {
  const person = identityConfigured ? uid : "local";
  if (!person || !workspaceId) return null;
  return `${person}:${orgSlugFromWorkspaceId(workspaceId) ?? "personal"}`;
}
