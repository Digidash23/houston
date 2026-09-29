import { expect, test } from "./support/fixtures";
import { workspaceMenuTrigger } from "./support/workspace-menu";

/**
 * The collapsed rail has one visible expand control at its top, and the
 * account portrait at its foot opens the workspace menu.
 */
test("collapsed sidebar expands from its visible toggle", async ({ page }) => {
  await page.goto("/");
  await expect(workspaceMenuTrigger(page)).toBeVisible();

  const sidebar = page.locator("[data-tour-target='sidebar']");

  // Collapse via the top-right toggle.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "56px");

  // Exactly one expand button, at the rail's top.
  const expandBtn = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expandBtn).toHaveCount(1);
  const btnBox = await expandBtn.boundingBox();
  const asideBox = await sidebar.boundingBox();
  if (!btnBox || !asideBox) throw new Error("missing bounding boxes");
  expect(btnBox.y - asideBox.y).toBeLessThan(30);

  await expect(expandBtn.locator("svg")).toBeVisible();
  const workspaceButton = workspaceMenuTrigger(page);
  await expect(workspaceButton).toBeVisible();
  await expandBtn.click();
  await expect(sidebar).toHaveCSS("width", "272px");

  // The portrait opens its menu and empty rail space leaves the rail closed.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "56px");
  await workspaceButton.click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.click(asideBox.x + 28, asideBox.y + asideBox.height - 200);
  await expect(sidebar).toHaveCSS("width", "56px");

  // The top line's own buttons keep their own action.
  await sidebar.getByTestId("rail-search").click();
  await expect(sidebar).toHaveCSS("width", "56px");
  await page.keyboard.press("Escape");
});

/**
 * The AI Manager is not a destination: it leads the employees list, pinned
 * above every group and employee, on the same person row an employee wears,
 * and it keeps that lead on the collapsed icon rail.
 */
test("Manager is the first employee row in both rail widths", async ({
  page,
}) => {
  await page.goto("/");
  const band = page.locator("[data-tour-target='agents']");
  const manager = band.getByTestId("rail-assistant");
  await expect(manager).toBeVisible();
  await expect(
    page.locator("[data-tour-target='sidebar']").getByTestId("rail-assistant"),
  ).toHaveCount(1);

  // Above the first employee.
  const managerBox = await manager.boundingBox();
  const firstAgent = band.locator("[data-sidebar-item]").first();
  const agentBox = await firstAgent.boundingBox();
  if (!managerBox || !agentBox) throw new Error("the band is not laid out");
  expect(managerBox.y + managerBox.height).toBeLessThanOrEqual(agentBox.y + 1);
  // The person row's height, like the agent under it.
  expect(managerBox.height).toBeCloseTo(agentBox.height, 1);

  // The avatar is decorative: the row's label is its name, then its role.
  // Round like the employees' avatars, it wears the one mark theirs do not:
  // the halo around it.
  await expect(manager.locator("[data-manager-avatar]")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(manager.locator("[data-manager-halo]")).toHaveCount(1);
  await expect(band.locator("[data-manager-halo]")).toHaveCount(1);
  const row = manager.getByRole("button", { name: /^Houston/ });
  await expect(row).toContainText("Your AI Manager");
  await row.click();
  await expect(page.getByTestId("assistant-chat")).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "page");

  // Collapsed, it is the first avatar on the icon rail and still lit.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(manager).toHaveAttribute("aria-label", "Houston");
  await expect(band.locator("button[aria-label]").first()).toHaveAttribute(
    "data-testid",
    "rail-assistant",
  );
  await expect(manager).toHaveClass(/bg-sidebar-active/);
});
