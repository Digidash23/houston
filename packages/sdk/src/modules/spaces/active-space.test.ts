import { describe, expect, it } from "vitest";
import { activeSpaceOrgSlug } from "./active-space";
import type { OrgSummary, OrgsList } from "./types";

function org(slug: string, kind: OrgSummary["kind"]): OrgSummary {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    kind,
    role: "owner",
    memberCount: 1,
    degraded: false,
  };
}

const MEMBERSHIPS: OrgsList = {
  orgs: [org("aaaaaaaaaaaaaaaa", "team"), org("383369a239383fee", "personal")],
  invites: [],
};

describe("activeSpaceOrgSlug", () => {
  it("answers the pinned team slug without reading memberships", () => {
    expect(activeSpaceOrgSlug("5f2b225f316c6079", undefined)).toBe(
      "5f2b225f316c6079",
    );
  });

  it("answers the personal membership's slug when no team is pinned", () => {
    expect(activeSpaceOrgSlug(null, MEMBERSHIPS)).toBe("383369a239383fee");
  });

  it("answers null while the memberships are unread", () => {
    expect(activeSpaceOrgSlug(null, undefined)).toBeNull();
  });

  it("answers null when no membership is personal", () => {
    const teamsOnly: OrgsList = {
      orgs: [org("aaaaaaaaaaaaaaaa", "team")],
      invites: [],
    };
    expect(activeSpaceOrgSlug(null, teamsOnly)).toBeNull();
  });
});
