/**
 * Visual-regression baselines for the pricing-change announcement and the
 * free-org picker: the bar, the picker, a payer's second step and the picked
 * line, at desktop and phone width. The page clock is pinned before the
 * cutover and every value on screen comes from the fixture.
 */
import type { BillingChoice } from "@houston/wire-types";
import type { Page } from "@playwright/test";
import {
  armCapabilities,
  armChoice,
  banner,
  installChoiceClock,
  LA_FILA,
  ownerChoice,
  payerChoice,
  picker,
  SPACES_OWNER_CAPS,
} from "../support/billing-choice";
import { expect, test } from "../support/fixtures";
import { pinTheme } from "./support";

test.use({ timezoneId: "UTC" });

const PHONE = { width: 390, height: 844 } as const;

async function boot(
  page: Page,
  width: "desktop" | "phone",
  choice: BillingChoice,
): Promise<void> {
  await installChoiceClock(page);
  if (width === "phone") await page.setViewportSize(PHONE);
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(choice);
  await page.goto("/");
  await expect(banner(page)).toBeVisible({ timeout: 15_000 });
}

async function openPicker(page: Page): Promise<void> {
  await banner(page)
    .getByRole("button", { name: "Choose your free organization" })
    .click();
  await expect(picker(page).getByRole("radio").first()).toBeVisible();
}

async function settle(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await pinTheme(page, "light");
}

for (const width of ["desktop", "phone"] as const) {
  test(`billing change bar — ${width}`, async ({ page }) => {
    await boot(page, width, ownerChoice());
    await settle(page);
    await expect(page).toHaveScreenshot(`billing-change-bar-${width}.png`);
  });

  test(`free org picker — ${width}`, async ({ page }) => {
    await boot(page, width, ownerChoice());
    await openPicker(page);
    await settle(page);
    await expect(page).toHaveScreenshot(`free-org-picker-${width}.png`);
  });
}

test("free org picker, payer step — desktop", async ({ page }) => {
  await boot(page, "desktop", payerChoice());
  await openPicker(page);
  await picker(page).getByRole("button", { name: "Keep La Fila free" }).click();
  await expect(picker(page)).toContainText("Step 2 of 2");
  await settle(page);
  await expect(page).toHaveScreenshot("free-org-picker-payer-desktop.png");
});

test("billing change bar, picked — desktop", async ({ page }) => {
  await boot(page, "desktop", ownerChoice({ freeOrgSlug: LA_FILA.slug }));
  await expect(banner(page)).toContainText("La Fila stays free.");
  await settle(page);
  await expect(page).toHaveScreenshot("billing-change-picked-desktop.png");
});
