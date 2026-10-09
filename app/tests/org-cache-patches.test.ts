import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { OrgInfo, OrgsList } from "@houston/wire-types";
import {
  orgsWithoutInvite,
  orgWithMemberRole,
  orgWithoutInvite,
  orgWithoutMember,
} from "../src/lib/org-cache-patches.ts";

const org: OrgInfo = {
  id: "o1",
  slug: "acme",
  name: "Acme",
  role: "owner",
  members: [
    { userId: "u1", role: "owner" },
    { userId: "u2", role: "user" },
  ],
  invites: [
    { id: "i1", email: "a@x.co", role: "user", invitedBy: "u1", createdAt: 1 },
  ],
};

describe("org cache patches", () => {
  it("drops a removed member and leaves the rest", () => {
    deepStrictEqual(
      orgWithoutMember(org, "u2")?.members?.map((m) => m.userId),
      ["u1"],
    );
  });

  it("is idempotent: a refetch that already lacks the member is untouched", () => {
    const once = orgWithoutMember(org, "u2");
    strictEqual(orgWithoutMember(once, "u2"), once);
    strictEqual(orgWithoutMember(org, "nobody"), org);
  });

  it("changes only the named member's role", () => {
    const next = orgWithMemberRole(org, "u2", "admin");
    deepStrictEqual(
      next?.members?.map((m) => m.role),
      ["owner", "admin"],
    );
    strictEqual(next?.members?.[0], org.members?.[0]);
    strictEqual(orgWithMemberRole(next, "u2", "admin"), next);
  });

  it("drops a revoked invite", () => {
    deepStrictEqual(orgWithoutInvite(org, "i1")?.invites, []);
    strictEqual(orgWithoutInvite(org, "gone"), org);
  });

  it("tolerates a cache that never loaded, or a roster the caller cannot see", () => {
    strictEqual(orgWithoutMember(undefined, "u1"), undefined);
    strictEqual(orgWithMemberRole(undefined, "u1", "user"), undefined);
    strictEqual(orgWithoutInvite(undefined, "i1"), undefined);
    const plain: OrgInfo = { id: "o1", slug: "acme", name: "A", role: "user" };
    strictEqual(orgWithoutMember(plain, "u1"), plain);
    strictEqual(orgWithoutInvite(plain, "i1"), plain);
  });

  it("drops an answered invite from the invitee's inbox", () => {
    const list: OrgsList = {
      orgs: [],
      invites: [
        { id: "i1", orgName: "Acme", role: "user" },
        { id: "i2", orgName: "Beta", role: "admin" },
      ],
    };
    deepStrictEqual(
      orgsWithoutInvite(list, "i1")?.invites.map((i) => i.id),
      ["i2"],
    );
    strictEqual(orgsWithoutInvite(list, "nope"), list);
    strictEqual(orgsWithoutInvite(undefined, "i1"), undefined);
  });
});
