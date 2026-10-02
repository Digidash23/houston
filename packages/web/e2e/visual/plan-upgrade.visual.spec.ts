import { expect, test } from "../support/fixtures";
import { openMoreMenu } from "../support/mobile-nav";
import { armPlan, freePlan, installPlanClock } from "../support/plan";
import { pinTheme, THEMES } from "./support";

for (const width of ["desktop", "phone"] as const) {
  for (const theme of THEMES) {
    for (const percent of [25, 85, 100]) {
      test(`upgrade ${percent}% ${width} ${theme}`, async ({ page }) => {
        await installPlanClock(page);
        await armPlan({
          summary: freePlan({ usage: { percent, used: percent, limit: 100 } }),
        });
        if (width === "phone")
          await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        const area =
          width === "phone"
            ? await openMoreMenu(page, "click")
            : page.getByTestId("sidebar-footer");
        // Two CI workers can boot past the default 10s window; match the
        // phone shell's boot budget before asserting the settled screenshot.
        await expect(area.getByTestId("plan-upgrade")).toBeVisible({
          timeout: 20_000,
        });
        await pinTheme(page, theme);
        await page.mouse.move(0, 0);
        await expect(area).toHaveScreenshot(
          `upgrade-${percent}-${width}-${theme}.png`,
        );
      });
    }
  }
}
