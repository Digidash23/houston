import { expect, test } from "./support/fixtures";
import {
  changeAnswer,
  managerOnboarding,
  reachTeamStep,
} from "./support/manager-onboarding";
import {
  ADDED_ROLE,
  addStarterCard,
  employeeNameField,
  finishOnboarding,
  hireStarterTeam,
  removeStarterCard,
  STARTER_ROLES,
  starterTeam,
} from "./support/manager-team";
import { openManagerOnboarding, resetToFirstRun } from "./support/onboarding";
import { agentRow, openAgentScreen, screen } from "./support/team-nav";

/**
 * First run's last step, the team, in the AI Manager's chat: no question
 * about how to build it, straight to the starter team, the "Build your team"
 * card's own employee cards named for their jobs and open to change.
 * "Hire one more" adds a card, a draft's Remove lets it go, and "Hire my
 * team" hires everyone as they stand (or renamed first,
 * onboarding-team-roster.spec.ts). The manager waits for every hire to land,
 * then starts the person's goal in the real chat. Every hire lands with its first
 * day PENDING: nobody starts working until the person presses
 * "Start <name>'s first day".
 */

test("the team step opens on the starter team, hired in one press", async ({
  page,
  request,
}) => {
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await reachTeamStep(page);

  // No question about how to build the team: the cards are already there.
  await expect(managerOnboarding(page).getByRole("radio")).toHaveCount(0);
  await expect(starterTeam(page)).toBeVisible();

  await hireStarterTeam(page, null, "click", STARTER_ROLES);
  // The hire is for good: nothing before it changes any more.
  await expect(changeAnswer(page)).toHaveCount(0);
  await finishOnboarding(page);
  for (const name of STARTER_ROLES)
    await expect(agentRow(page, name)).toBeVisible();

  // Their first day waits for the person: the employee's board offers it.
  await openAgentScreen(page, STARTER_ROLES[0]);
  await expect(
    screen(page).getByRole("button", {
      name: `Start ${STARTER_ROLES[0]}'s first day`,
    }),
  ).toBeVisible();

  // Finished is finished: a reload stays in the app.
  await page.reload();
  await expect(agentRow(page, STARTER_ROLES[0])).toBeVisible();
  await expect(managerOnboarding(page)).toHaveCount(0);
});

test("Hire one more adds a card, Remove lets one go, and the team hired is the one shown", async ({
  page,
  request,
}) => {
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await reachTeamStep(page);
  const step = starterTeam(page);

  await addStarterCard(page);
  await expect(step.getByRole("textbox", { name: /^Name / })).toHaveCount(4);

  // Remove the operations manager before anyone is hired.
  await removeStarterCard(page, STARTER_ROLES[1]).click();
  await expect(employeeNameField(step, STARTER_ROLES[1])).toHaveCount(0);
  await expect(step.getByRole("textbox", { name: /^Name / })).toHaveCount(3);

  // The card added sits on top, before the starters.
  const team = [ADDED_ROLE, STARTER_ROLES[0], STARTER_ROLES[2]];
  await hireStarterTeam(page, null, "click", team);
  await finishOnboarding(page);
  for (const name of team) await expect(agentRow(page, name)).toBeVisible();
  await expect(agentRow(page, STARTER_ROLES[1])).toHaveCount(0);
});
