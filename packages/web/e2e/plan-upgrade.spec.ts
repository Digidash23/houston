import { expect, test } from "./support/fixtures";
import {
  armPlan,
  billingScreen,
  freePlan,
  installPlanClock,
  planCallCount,
  plusPlan,
} from "./support/plan";

test.beforeEach(async ({ page }) => {
  await installPlanClock(page);
});

for (const { percent, status } of [
  { percent: 25, status: "Free plan" },
  { percent: 80, status: "80% of weekly usage used" },
  { percent: 100, status: "Usage limit reached" },
]) {
  test(`sidebar upgrade stays visible at ${percent}% and opens Billing`, async ({
    page,
  }) => {
    await armPlan({
      summary: freePlan({ usage: { percent, used: percent, limit: 100 } }),
    });
    await page.goto("/");
    const upgrade = page
      .getByTestId("sidebar-footer")
      .getByTestId("plan-upgrade");
    await expect(upgrade).toContainText("Upgrade to Plus");
    await expect(upgrade).toContainText(status);
    const apps = page.locator('[data-tour-target="nav-integrations"]');
    const upgradeBox = await upgrade.boundingBox();
    const appsBox = await apps.boundingBox();
    if (!upgradeBox || !appsBox)
      throw new Error("Footer controls must be visible");
    expect(upgradeBox.y + upgradeBox.height).toBeLessThanOrEqual(appsBox.y);
    await upgrade.click();
    await expect(
      billingScreen(page).getByRole("heading", { name: "Billing", level: 1 }),
    ).toBeVisible();
    expect(await planCallCount("checkout")).toBe(0);
  });
}

test("collapsed sidebar keeps upgrade and its usage state accessible", async ({
  page,
}) => {
  await armPlan({
    summary: freePlan({ usage: { percent: 100, used: 40, limit: 40 } }),
  });
  await page.goto("/");
  await expect(page.getByTestId("plan-upgrade")).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  const upgrade = page.getByTestId("plan-upgrade");
  await expect(upgrade).toHaveAccessibleName(
    "Upgrade to Plus. Usage limit reached",
  );
  await upgrade.click();
  await expect(billingScreen(page)).toBeVisible();
});

test("Plus and deployments without personal plans have no upgrade entry", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  await expect(page.getByTestId("plan-upgrade")).toHaveCount(0);
  await armPlan({ summary: plusPlan(true) });
  await page.reload();
  await expect.poll(() => planCallCount("plan")).toBeGreaterThan(0);
  await expect(page.getByTestId("plan-upgrade")).toHaveCount(0);
});
