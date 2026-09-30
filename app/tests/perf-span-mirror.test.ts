import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { Capabilities, OrgsList } from "@houston/engine-adapter";
import {
  perfSpanEventProps,
  perfSpanOrgSlug,
} from "../src/lib/perf-span-mirror.ts";
import { PERSONAL_WORKSPACE_ID } from "../src/lib/space-id.ts";
import { TRACKED_ALLOWED_PROPS } from "./fixtures/analytics-source.ts";

const BASE: Capabilities = {
  profile: "local",
  revealInOs: true,
  terminal: true,
  tunnel: false,
  codeExecution: "local-bash",
  providers: [],
  openaiCompatible: true,
  integrations: [],
  sharedSkills: true,
};
const DESKTOP: Capabilities = BASE;
const SELF_HOST: Capabilities = { ...BASE, profile: "cloud" };
const GATEWAY: Capabilities = { ...BASE, profile: "cloud", spaces: true };

const MEMBERSHIPS: OrgsList = {
  orgs: [
    {
      id: "o1",
      slug: "383369a239383fee",
      name: "Personal",
      kind: "personal",
      role: "owner",
      memberCount: 1,
      degraded: false,
    },
  ],
  invites: [],
};

describe("perfSpanOrgSlug", () => {
  it("is the pinned team's slug in a hosted team space", () => {
    strictEqual(
      perfSpanOrgSlug(GATEWAY, "org:5f2b225f316c6079", undefined),
      "5f2b225f316c6079",
    );
  });

  it("is the personal membership's slug in the hosted personal space", () => {
    strictEqual(
      perfSpanOrgSlug(GATEWAY, PERSONAL_WORKSPACE_ID, MEMBERSHIPS),
      "383369a239383fee",
    );
  });

  it("is null while the hosted memberships are unread", () => {
    strictEqual(
      perfSpanOrgSlug(GATEWAY, PERSONAL_WORKSPACE_ID, undefined),
      null,
    );
  });

  it("is null on desktop, even with memberships cached from a hosted session", () => {
    strictEqual(
      perfSpanOrgSlug(DESKTOP, PERSONAL_WORKSPACE_ID, MEMBERSHIPS),
      null,
    );
  });

  it("is null on self-host and while capabilities load", () => {
    strictEqual(
      perfSpanOrgSlug(SELF_HOST, PERSONAL_WORKSPACE_ID, MEMBERSHIPS),
      null,
    );
    strictEqual(perfSpanOrgSlug(null, "org:5f2b225f316c6079", undefined), null);
  });
});

describe("perfSpanEventProps", () => {
  it("carries the org slug when the span has one", () => {
    deepStrictEqual(
      perfSpanEventProps("send_to_first_response", 800, "5f2b225f316c6079"),
      {
        span: "send_to_first_response",
        duration_ms: 800,
        org_slug: "5f2b225f316c6079",
      },
    );
  });

  it("leaves org_slug out entirely when there is no org", () => {
    const props = perfSpanEventProps("send_to_first_response", 800, null);
    deepStrictEqual(props, {
      span: "send_to_first_response",
      duration_ms: 800,
    });
    ok(!("org_slug" in props), "org_slug must be absent, not empty");
  });

  it("only sends properties the analytics allow-list keeps", () => {
    const props = perfSpanEventProps("app_to_board", 5, "5f2b225f316c6079");
    for (const key of Object.keys(props)) {
      ok(TRACKED_ALLOWED_PROPS.has(key), `cleanProps would drop "${key}"`);
    }
  });
});
