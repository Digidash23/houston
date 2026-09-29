import { SEED_AGENT_ID } from "@houston/fake-host";
import { newAgentButton } from "./support/create-agent";
import { expect, test } from "./support/fixtures";
import { seedSidebarLayout } from "./support/sidebar-layout";
import { litRows, navRow, rail, screen, teamTab } from "./support/team-nav";
import {
  openWorkspaceMenu,
  railDestination,
  workspaceMenuTrigger,
} from "./support/workspace-menu";

/**
 * The whole harness in one spec: the full desktop UI boots in the browser, on
 * the host adapter (host mode), against the fake host — past the
 * engine Connect screen and the language picker — and the
 * files-first board data (`.houston/activity/activity.json`) flows through.
 *
 * It is also where the rail's shape is pinned: Search and "+" on its top line,
 * the AI Employees under it closed by the "Add new AI Employee" shortcut, and
 * at its foot the connect rows (Integrations, AI Models) over the account
 * row, whose menu holds the Academy and Settings. Desktop opens the first
 * employee once the roster and layout resolve.
 */
test("boots past every gate onto the first employee's Tasks", async ({
  page,
}) => {
  await seedSidebarLayout(page.request, {
    groups: [
      { id: "home", name: "Home", collapsed: false, agentIds: [SEED_AGENT_ID] },
    ],
    order: [],
  });
  await page.goto("/");

  // Shell chrome: the rail's top line, its people, and its foot.
  const sidebar = page.locator("[data-tour-target='sidebar']");
  await expect(sidebar.getByTestId("rail-search")).toBeVisible();
  await expect(newAgentButton(page)).toBeVisible();
  await expect(sidebar.getByText("Workspace", { exact: true })).toHaveCount(0);
  await expect(workspaceMenuTrigger(page)).toBeVisible();
  await expect(sidebar.getByTestId("rail-add-employee")).toBeVisible();
  // The connect rows sit on the rail's foot, each named by its label alone
  // (its logos are decorative); the rest lives in the account row's menu.
  await expect(railDestination(page, "nav-integrations")).toHaveAccessibleName(
    "Connect your apps",
  );
  await expect(railDestination(page, "nav-ai-hub")).toHaveAccessibleName(
    "Connect your AI",
  );
  const menu = await openWorkspaceMenu(page);
  await expect(navRow(page, "academy")).toBeVisible();
  await expect(navRow(page, "settings")).toBeVisible();
  for (const id of ["ai-hub", "integrations"]) {
    await expect(menu.locator(`[data-tour-target='nav-${id}']`)).toHaveCount(0);
  }
  await page.keyboard.press("Escape");

  // The group header only folds; its first member is selected at boot.
  await expect(
    litRows(rail(page).locator('[data-sidebar-group-header="home"]')),
  ).toHaveCount(0);
  await expect(
    litRows(
      rail(page).locator(
        `[data-sidebar-item][data-item-id="${SEED_AGENT_ID}"]`,
      ),
    ),
  ).toHaveCount(1);
  await expect(screen(page)).toHaveAttribute("data-screen", "agent");
  await expect(teamTab(page, "Tasks")).toHaveAttribute("aria-current", "page");

  // The board rendered with its three columns + the seeded missions (proves the
  // files-first data path works end-to-end).
  await expect(screen(page).getByText("Running")).toBeVisible();
  await expect(screen(page).getByText("Needs you")).toBeVisible();
  await expect(screen(page).getByText("Done", { exact: true })).toBeVisible();
  await expect(screen(page).getByText("Plan a trip to Tokyo")).toBeVisible();

  // None of the boot gates are left on screen.
  await expect(
    page.getByText(
      /Connecting to engine|Loading your workspace|Language · Idioma|Can't reach the engine/i,
    ),
  ).toHaveCount(0);
});
