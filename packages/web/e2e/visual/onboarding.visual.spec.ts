/**
 * Visual-regression baselines for the first-run experience.
 *
 * The app's true first screen is the LANGUAGE gate (before sign-in). The base
 * fixture seeds `locale=en` to skip it, so its baseline clears that pref (and
 * i18next's detector cache) to render the picker, exactly as
 * onboarding-language.spec.ts does. It is a flat, centered light card with a
 * button per language: no backdrop photo, no clock, no host data. The pre-app
 * screens pin `data-theme="light"` themselves (see theme-pin.spec.ts), so it
 * has a single baseline, no theme axis.
 *
 * Onboarding proper is the AI Manager's conversation inside the workspace
 * shell, so it follows the app theme: its baselines run in both. Two settled
 * steps are captured, the "Connect your AI" step under the manager's hello,
 * and the first survey question (the create sheet's industry step, the
 * connection's answer above it). The visual project emulates reduced
 * motion, so the manager's messages show whole rather than typing out.
 */
import { subscriptionCard } from "../support/connect-ai";
import { expect, test } from "../support/fixtures";
import {
  connectAi,
  connectAiStep,
  managerStep,
} from "../support/manager-onboarding";
import { openManagerOnboarding, resetToFirstRun } from "../support/onboarding";
import { pinTheme, THEMES } from "./support";

test("first-run language gate", async ({ page }) => {
  // Drop the seeded locale so the LanguageGate renders as the first screen.
  await page.addInitScript(() => {
    localStorage.removeItem("houston.pref.locale");
    localStorage.removeItem("i18nextLng");
  });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  // The picker's three language buttons anchor a fully-painted card.
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Português" })).toBeVisible();

  await expect(page).toHaveScreenshot("first-run-language.png", {
    fullPage: true,
  });
});

for (const theme of THEMES) {
  test(`first-run connect step — ${theme}`, async ({ page, request }) => {
    await resetToFirstRun(request);
    await openManagerOnboarding(page);
    await expect(connectAiStep(page)).toBeVisible();
    await expect(subscriptionCard(page, "Claude")).toBeVisible();
    await pinTheme(page, theme);

    await expect(page).toHaveScreenshot(`first-run-connect-${theme}.png`, {
      fullPage: true,
    });
  });

  test(`first-run survey question — ${theme}`, async ({ page, request }) => {
    await resetToFirstRun(request);
    await openManagerOnboarding(page);
    await connectAi(page);
    await expect(managerStep(page, "survey-industry")).toBeVisible();
    // Settled: the key dialog gone with its backdrop, and the sign-in toast
    // gone, so the capture is the step alone.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Signed in to OpenRouter")).toHaveCount(0, {
      timeout: 15_000,
    });
    await pinTheme(page, theme);

    await expect(page).toHaveScreenshot(`first-run-survey-${theme}.png`, {
      fullPage: true,
    });
  });
}
