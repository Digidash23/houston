import { expect, test } from "./support/fixtures";
import {
  BASIC_TEAM_ROLES,
  basicTeamOption,
  hireOnTeamCard,
  hireYourTeamOption,
  openNewWorkspaceTeamCard,
  TEAM_CARD_INDUSTRY,
  TEAM_HIRE_ROLE,
  teamCardBriefLine,
  teamCardBriefPicker,
  teamCardNameField,
} from "./support/team-card";
import {
  agentRow,
  openAgentScreen,
  openAgentSettings,
  screen,
} from "./support/team-nav";

/**
 * "Build your team" (`onboarding/team/*`), the card a new workspace opens on:
 * the basic team of three, named for their jobs and hired in one press, or
 * the in-app hire (the survey's industry already answered, a job, a name the
 * job fills in) once per AI Employee. Both paths hire into one roster, so switching keeps everyone,
 * and every hire lands with its first day PENDING. Done closes the dialog.
 */

test("the basic team hires the three starters and closes the dialog", async ({
  page,
  request,
}) => {
  const dialog = await openNewWorkspaceTeamCard(page, request);

  await basicTeamOption(page).click();
  await expect(
    page.getByRole("heading", { name: "Meet your new team" }),
  ).toBeVisible();
  // Each starter arrives named for its job, and says it can change.
  for (const role of BASIC_TEAM_ROLES) {
    await expect(teamCardNameField(page, role)).toHaveValue(role);
  }
  await expect(
    page.getByText(
      "Everything here is editable: change any name, job or color before you hire them.",
    ),
  ).toBeVisible();
  await teamCardNameField(page, "Executive assistant").fill("Ava");

  // A name cleared to blank says so on that card and takes the person to it,
  // which shows the examples instead: led by the job when the field has room
  // for it whole, the examples alone when it does not, never cut short.
  const cleared = teamCardNameField(page, "Operations manager");
  await cleared.fill("");
  await expect(cleared).toHaveAttribute(
    "placeholder",
    /^e\.g\. (Ava|Operations manager, Assistant 3, Jerry)$/,
  );
  await page.getByRole("button", { name: "Hire my team" }).click();
  await expect(page.getByText("Add a name to continue")).toHaveCount(1);
  await expect(cleared).toBeFocused();

  // The last one keeps its job's name.
  await cleared.fill("Otto");
  await page.getByRole("button", { name: "Hire my team" }).click();

  await expect(dialog).toBeHidden();
  for (const name of ["Ava", "Otto", "Finance manager"]) {
    await expect(agentRow(page, name)).toBeVisible();
  }
  // Their first day waits for the person: the employee's board offers it.
  await openAgentScreen(page, "Ava");
  await expect(
    screen(page).getByRole("button", { name: "Start Ava's first day" }),
  ).toBeVisible();
});

test("a basic team card takes a new job and industry, and hires with them", async ({
  page,
  request,
}) => {
  await openNewWorkspaceTeamCard(page, request);
  await basicTeamOption(page).click();

  // The job line opens the hire's own role question; a chip answers it.
  await teamCardBriefLine(page, "role", "Executive assistant").click();
  const rolePicker = teamCardBriefPicker(page, "role");
  await rolePicker
    .getByRole("radio", { name: "Researcher", exact: true })
    .click();
  await expect(rolePicker).toBeHidden();
  await expect(teamCardNameField(page, "Researcher")).toBeVisible();

  // The keyboard opens the industry question and Escape hands focus back.
  const industryLine = teamCardBriefLine(page, "industry", TEAM_CARD_INDUSTRY);
  await industryLine.first().focus();
  await page.keyboard.press("Enter");
  const industryPicker = teamCardBriefPicker(page, "industry");
  await expect(industryPicker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(industryPicker).toBeHidden();
  await expect(industryLine.first()).toBeFocused();

  // A new industry is that card's alone, and it keeps the job.
  await industryLine.first().click();
  await industryPicker
    .getByRole("textbox", { name: "Search industries" })
    .fill("Accounting");
  await industryPicker
    .getByRole("radio", { name: "Accounting", exact: true })
    .click();
  await expect(industryPicker).toBeHidden();
  await expect(teamCardBriefLine(page, "industry", "Accounting")).toBeVisible();
  await expect(teamCardBriefLine(page, "role", "Researcher")).toBeVisible();
  await expect(industryLine).toHaveCount(2);

  for (const [role, name] of [
    ["Researcher", "Ava"],
    ["Operations manager", "Otto"],
    ["Finance manager", "Felix"],
  ] as const) {
    await teamCardNameField(page, role).fill(name);
  }
  await page.getByRole("button", { name: "Hire my team" }).click();
  await expect(agentRow(page, "Ava")).toBeVisible();

  // The hire's job description carries the brief the card showed.
  await openAgentSettings(page, "Ava");
  await expect(
    screen(page).getByRole("button", { name: /^Change role: / }),
  ).toHaveText("Researcher");
  await expect(
    screen(page).getByRole("button", { name: /^Change industry: / }),
  ).toHaveText("Accounting");
});

test("hiring one by one builds a roster, and Done closes the dialog", async ({
  page,
  request,
}) => {
  const dialog = await openNewWorkspaceTeamCard(page, request);

  await hireYourTeamOption(page).click();
  await hireOnTeamCard(page, "Pax");
  await expect(
    page.getByRole("heading", { name: "You hired your first AI Employee" }),
  ).toBeVisible();
  // A hire on the roster is edited in place: the rename saves on Enter.
  await expect(page.getByText("On your team", { exact: true })).toBeVisible();
  await teamCardNameField(page, TEAM_HIRE_ROLE).fill("Piper");
  await teamCardNameField(page, TEAM_HIRE_ROLE).press("Enter");

  await page.getByRole("button", { name: "Hire another" }).click();
  await hireOnTeamCard(page, "Quill");
  await expect(
    page.getByRole("heading", { name: "You hired 2 AI Employees" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(agentRow(page, "Piper")).toBeVisible();
  await expect(agentRow(page, "Quill")).toBeVisible();
});

test("a hire made one by one stays on the team when the basic team joins", async ({
  page,
  request,
}) => {
  await openNewWorkspaceTeamCard(page, request);

  await hireYourTeamOption(page).click();
  await hireOnTeamCard(page, "Pax");

  // Back from the roster is the choice, which counts the team so far.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByText("You have 1 AI Employee on your team so far"),
  ).toBeVisible();
  await basicTeamOption(page).click();
  for (const [role, name] of [
    ["Executive assistant", "Ava"],
    ["Operations manager", "Otto"],
    ["Finance manager", "Felix"],
  ] as const) {
    await teamCardNameField(page, role).fill(name);
  }
  await page.getByRole("button", { name: "Hire my team" }).click();

  for (const name of ["Pax", "Ava", "Otto", "Felix"]) {
    await expect(agentRow(page, name)).toBeVisible();
  }
});
