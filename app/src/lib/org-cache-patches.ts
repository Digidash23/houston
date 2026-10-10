import type { OrgInfo, OrgRole, OrgsList } from "@houston/wire-types";
import { mapItem, withoutItems } from "./list-patch.ts";

/**
 * Optimistic edits of the People screen's `GET /org` cache (roster + pending
 * invites ride on it) and the invite inbox's `GET /v1/orgs`. Pure, idempotent,
 * and the same object back when there is nothing to change.
 */

export function orgWithoutMember(
  org: OrgInfo | undefined,
  userId: string,
): OrgInfo | undefined {
  if (!org) return org;
  const members = withoutItems(org.members, (m) => m.userId === userId);
  return members === org.members ? org : { ...org, members };
}

export function orgWithMemberRole(
  org: OrgInfo | undefined,
  userId: string,
  role: OrgRole,
): OrgInfo | undefined {
  if (!org) return org;
  const members = mapItem(
    org.members,
    (m) => m.userId === userId,
    (m) => (m.role === role ? m : { ...m, role }),
  );
  return members === org.members ? org : { ...org, members };
}

export function orgWithoutInvite(
  org: OrgInfo | undefined,
  inviteId: string,
): OrgInfo | undefined {
  if (!org) return org;
  const invites = withoutItems(org.invites, (i) => i.id === inviteId);
  return invites === org.invites ? org : { ...org, invites };
}

/** The invitee's side: an answered invite leaves the inbox. */
export function orgsWithoutInvite(
  list: OrgsList | undefined,
  inviteId: string,
): OrgsList | undefined {
  if (!list) return list;
  const invites = withoutItems(list.invites, (i) => i.id === inviteId);
  return invites === list.invites ? list : { ...list, invites };
}
