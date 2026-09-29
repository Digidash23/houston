import { FAKE_HOST_URL } from "@houston/fake-host";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { screen } from "./support/team-nav";
import {
  openNavRow,
  openWorkspaceMenu,
  railDestination,
} from "./support/workspace-menu";

/**
 * The integrations permissioning information architecture (the IA end-state).
 * Each concept now has exactly one home:
 *  - POLICY (who can use each agent + what each agent may use — org/agent app
 *    and model ceilings) → the ONE canonical agent settings page, reached
 *    through the team that owns the agent ("focused agent screen").
 *    Covered by `agent-policy.spec.ts`; it is NOT the global Integrations page,
 *    which is always the personal catalog now;
 *  - CATALOG + ACCOUNTS (the caller's personal connected apps) → the global
 *    Integrations page, its one surface, visible to EVERY role in every mode (a
 *    plain member keeps its nav). The SHARED SKILLS library is a screen of its
 *    own from its own rail row, behind the space-owner gate
 *    (`settings-ia.spec.ts`, `spaces-gating.spec.ts`). Opening a connected app's
 *    detail modal shows info + reconnect + disconnect ONLY — which agents may
 *    use an app is managed in one place, the agent's own settings page, never
 *    here. Settings > Connected accounts is GONE (no settings row at all; the
 *    sidebar nav is the one way in);
 *
 * The per-agent Integrations TAB is GONE with the agent tab shell: connections
 * are the caller's, not an agent's (Composio platform mode), so the global page
 * is the one catalog, and the agent's app CEILING is the "Integrations" section of its
 * settings page (`agent-policy.spec.ts`).
 *
 * The Teams-shaped state single-player can't reach is armed via the fake host's
 * `/__test__/capabilities` (advertise `multiplayer` + `teams` + a `role`)
 * control. See `@houston/fake-host` README + `packages/web/e2e/README.md`.
 */

/** Teams owner: integrations on, multiplayer + Teams, top role. */
const OWNER_CAPS = {
  integrations: ["composio"],
  multiplayer: true,
  teams: true,
  role: "owner",
};

async function armCapabilities(
  request: APIRequestContext,
  caps: Record<string, unknown>,
): Promise<void> {
  await request.post(`${FAKE_HOST_URL}/__test__/capabilities`, { data: caps });
}

async function openIntegrations(page: Page): Promise<void> {
  await page.goto("/");
  await openNavRow(page, "integrations");
}

// ── 1. Plain member: no Admin dashboard, but the personal catalog stays ────

test("Teams member: no Admin dashboard, but the Integrations nav opens the personal catalog", async ({
  page,
  request,
}) => {
  // A plain member never sees the policy surface: the org ceiling is admin-owned
  // (the Admin page). But the Integrations nav is now unconditional — a member
  // keeps it and manages their own apps from the personal catalog.
  await armCapabilities(request, { ...OWNER_CAPS, role: "user" });
  await page.goto("/");

  // The Integrations row IS present for a member (unconditional), and it
  // opens the personal catalog — never the org policy question. It sits on
  // the rail's foot beside the AI row, the rows every caller gets.
  const integrationsNav = railDestination(page, "nav-integrations");
  await expect(integrationsNav).toBeVisible();
  await expect(railDestination(page, "nav-ai-hub")).toBeVisible();

  // A plain member has no Admin item. Asserted in the same open menu as
  // Settings, so that absence is the gate and not an unpainted menu.
  const menu = await openWorkspaceMenu(page);
  await expect(menu.locator('[data-tour-target="nav-settings"]')).toBeVisible();
  await expect(menu.getByTestId("rail-admin")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The Integrations row opens the catalog directly, and its identity
  // lozenge carries the screen's h1.
  await integrationsNav.click();
  await expect(
    page.getByRole("heading", { name: "Integrations", exact: true }),
  ).toBeVisible();
  await expect(
    screen(page).locator("[data-integrations-section='catalog']"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Which apps can agents in this workspace use?",
    }),
  ).toHaveCount(0);
});

// ── 2. Integrations page: personal connections only, no agent list ─────────

test("Integrations page: an installed app's detail modal shows no agent list", async ({
  page,
  request,
}) => {
  // Single-player with apps. The seeded (connected) Gmail tiles the Installed
  // strip; browse excludes it, so its tile is the only Gmail affordance. This
  // page is a personal-connections surface now — no per-agent grants anywhere.
  await armCapabilities(request, { integrations: ["composio"] });
  await openIntegrations(page);

  await page.getByRole("button", { name: "Gmail" }).click();

  // The detail modal is info + reconnect + disconnect ONLY: no "Agents that can
  // use this" block and no per-agent Switch — permissions live in one place now.
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await expect(page.getByText("Agents that can use this")).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
});
