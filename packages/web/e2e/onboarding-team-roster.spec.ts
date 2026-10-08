import type { Route } from "@playwright/test";
import { evictMidClosing, holdClosingSave } from "./support/closing-save";
import { expect, test } from "./support/fixtures";
import { managerOnboarding, reachTeamStep } from "./support/manager-onboarding";
import {
  afterHire,
  finishOnboarding,
  goalCard,
  hireStarterTeam,
  roster,
  STARTER_ROLES,
  starterTeam,
  TEAM_DONE_CHOICE,
  teamNext,
} from "./support/manager-team";
import { openManagerOnboarding, resetToFirstRun } from "./support/onboarding";
import { resolveServeMode } from "./support/serve-mode";
import { agentRow } from "./support/team-nav";

/**
 * The starter team's hire in the AI Manager's chat: each card named for its
 * job and open to a new name, "Hire my team" creating everyone behind the
 * person and waiting for every hire to land before the Manager closes. A
 * hire that failed says so on its card and offers Retry; a tab evicted
 * after the team is hired resumes on it, and so should a reload
 * (PRODUCT-2040, pinned failing below).
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

test("a tab evicted after the team is hired resumes on it, and That's my team closes", async ({
  page,
  request,
}) => {
  // Hiring flips the zero-agent first-run signal; the pending onboarding stage
  // is what holds the person on the team step until they finish it. The
  // closing's save is held so the eviction lands before onboarding finishes.
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await reachTeamStep(page);
  const release = await holdClosingSave(request);
  await hireStarterTeam(page, null, "click", STARTER_ROLES);

  const resumed = await evictMidClosing(page);
  await release();
  await expect(
    managerOnboarding(resumed).getByText(
      "You already have 3 AI Employees on your team. Let's pick up where you left off.",
    ),
  ).toBeVisible();
  await expect(teamNext(resumed)).toBeVisible();
  await expect(roster(resumed).locator('li[data-status="hired"]')).toHaveCount(
    3,
  );

  await afterHire(resumed, TEAM_DONE_CHOICE);
  // The resumed run finishes into the manager's real chat, on the goal card.
  // Its team card is not checked here: after a reload mid-closing the chat
  // can open without the conversation above the goal card (PRODUCT-1960).
  const chat = resumed.getByTestId("assistant-chat");
  await expect(chat).toBeVisible({ timeout: 15_000 });
  await expect(managerOnboarding(resumed)).toHaveCount(0);
  await expect(goalCard(chat)).toBeVisible();
  for (const name of STARTER_ROLES)
    await expect(agentRow(resumed, name)).toBeVisible();
});

test("a reload after the team is hired resumes on it", async ({
  page,
  request,
}) => {
  // PRODUCT-2040. A reload aborts the held import; the closing treats the
  // abort as a failed import and finishes onboarding from the dying page, so
  // `onboarding_completed` lands and the reload opens the app with an empty
  // manager chat. Deterministic against the prebuilt bundle (CI); the dev
  // server's slower reload tears the page down before that handler runs, so
  // there the spec passes. Make it a plain passing spec with the fix.
  test.fail(
    resolveServeMode() === "bundle",
    "PRODUCT-2040: the closing finishes onboarding on an aborted import",
  );
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await reachTeamStep(page);
  const release = await holdClosingSave(request);
  await hireStarterTeam(page, null, "click", STARTER_ROLES);

  await page.reload();
  await release();
  await expect(teamNext(page)).toBeVisible();
  await expect(roster(page).locator('li[data-status="hired"]')).toHaveCount(3);
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
