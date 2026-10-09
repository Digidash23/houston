import { expect, test } from "./support/fixtures";
import { hireWithNoAiConnected } from "./support/no-ai";
import { openAgentScreen, screen } from "./support/team-nav";

/**
 * A new hire's first day runs on the person's AI. With none connected the
 * start button would fire a turn nothing can answer (HOUSTON-APP-5H4), so the
 * hero offers "Connect AI to start" instead, which opens the AI Hub.
 */
test("with no AI connected the first-day hero offers Connect AI, not a start", async ({
  page,
  request,
}) => {
  await hireWithNoAiConnected(request, "Scout");
  await page.goto("/");
  await openAgentScreen(page, "Scout");

  const hero = screen(page).getByTestId("first-day-hero");
  await expect(
    hero.getByRole("button", { name: "Connect AI to start" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    hero.getByRole("button", { name: "Start Scout's first day" }),
  ).toHaveCount(0);

  await hero.getByRole("button", { name: "Connect AI to start" }).click();
  await expect(
    page.getByRole("heading", { name: "AI Providers" }),
  ).toBeVisible();
});
