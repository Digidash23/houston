import type { Route } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { managerOnboarding, reachTeamStep } from "./support/manager-onboarding";
import {
  afterHire,
  finishOnboarding,
  hireStarterTeam,
  holdClosingSave,
  roster,
  STARTER_ROLES,
  starterTeam,
  TEAM_DONE_CHOICE,
  teamNext,
} from "./support/manager-team";
import { openManagerOnboarding, resetToFirstRun } from "./support/onboarding";
import { agentRow } from "./support/team-nav";

/**
 * The starter team's hire in the AI Manager's chat: each card named for its
 * job and open to a new name, "Hire my team" creating everyone behind the
 * person and waiting for every hire to land before the Manager closes. A
 * hire that failed says so on its card and offers Retry; a reload
 * after the team is hired resumes on it.
 */

test("renamed cards hire under the names given", async ({ page, request }) => {
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await reachTeamStep(page);

  const names = ["Olivia", "Felix", "Nora"];
  await hireStarterTeam(page, names, "click", STARTER_ROLES);
  await finishOnboarding(page);
  for (const name of names) await expect(agentRow(page, name)).toBeVisible();
});

test("a reload after the team is hired resumes on it, and That's my team closes", async ({
  page,
  request,
}) => {
  // Hiring flips the zero-agent first-run signal; the pending onboarding stage
  // is what holds the person on the team step until they finish it. The
  // closing's save is held so the reload lands before onboarding finishes.
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await reachTeamStep(page);
  const release = await holdClosingSave(request);
  await hireStarterTeam(page, null, "click", STARTER_ROLES);

  await page.reload();
  await release();
  await expect(
    managerOnboarding(page).getByText(
      "You already have 3 AI Employees on your team. Let's pick up where you left off.",
    ),
  ).toBeVisible();
  await expect(teamNext(page)).toBeVisible();
  await expect(roster(page).locator('li[data-status="hired"]')).toHaveCount(3);

  await afterHire(page, TEAM_DONE_CHOICE);
  await finishOnboarding(page);
  for (const name of STARTER_ROLES)
    await expect(agentRow(page, name)).toBeVisible();
});

test("a hire that failed says so on its card, and Retry lands it", async ({
  page,
  request,
}) => {
  await resetToFirstRun(request);
  // The first create fails; every one after it lands.
  let failures = 1;
  await page.route(
    (url) => url.pathname === "/agents",
    async (route: Route) => {
      if (route.request().method() !== "POST" || failures === 0) {
        await route.continue();
        return;
      }
      failures -= 1;
      await route.fulfill({
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: { message: "create failed" } }),
      });
    },
  );
  await openManagerOnboarding(page);
  await reachTeamStep(page);
  const step = starterTeam(page);
  await step.getByRole("button", { name: "Hire my team" }).click();

  // The failure stays on its card, and the Manager does not close yet.
  await expect(
    step.getByText("We could not create this AI Employee. Please try again."),
  ).toBeVisible();
  await expect(
    managerOnboarding(page).getByText("Your team is ready!", { exact: true }),
  ).toHaveCount(0);

  await step.getByRole("button", { name: /^Try hiring .+ again$/ }).click();
  // Everyone has joined: the same press now only finishes the team.
  await step.getByRole("button", { name: "Hire my team" }).click();
  // The closing is one card, handed straight to the real chat: read it
  // wherever the conversation is on screen.
  await expect(
    managerOnboarding(page)
      .or(page.getByTestId("assistant-chat"))
      .getByText("Your team is ready!", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await finishOnboarding(page);
});
