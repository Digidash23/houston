import { expect, test } from "./support/fixtures";
import { openAgentSkills } from "./support/skills-nav";
import { screen } from "./support/team-nav";

/**
 * The skills surfaces must render without React integrity errors. Guards two
 * regressions this branch fixed: interactive buttons passed through
 * CatalogRow's `trailing` slot (which renders INSIDE the row's <button> —
 * nested buttons corrupt the DOM tree and break clicking), and the sidebar's
 * activity-cache subscription re-rendering synchronously from another
 * component's render (setState-in-render).
 *
 * The surface is an AI Employee's own Skills section, walked from its empty
 * state into its guided create chat.
 */
test("skills surfaces render without React integrity errors", async ({
  page,
  request,
  fakeHost,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  // Seed a shared skill so the store-backed rows take part.
  await request.post(`${fakeHost.url}/v1/workspaces/default/shared-skills`, {
    data: {
      name: "meeting-prep",
      description: "Prep before meetings",
      content:
        '---\nname: meeting-prep\ntitle: "Meeting prep"\ndescription: "Prep before meetings"\n---\n# Steps\n',
    },
  });

  await page.goto("/");
  await openAgentSkills(page);
  // The seeded skill sits in the workspace store and this employee loads none
  // of it, so its section is the empty state: the "Your skills" heading and
  // its count stand over rows, never over an absence.
  await expect(screen(page).getByText("No skills yet")).toBeVisible();

  // With a workspace store "Create skill" is a menu; its first way opens the
  // guided chat beside the list.
  await screen(page).getByRole("button", { name: "Create skill" }).click();
  await page.getByRole("menuitem", { name: "Create with chat" }).click();
  await expect(page.getByTestId("mission-panel")).toBeVisible();

  const react = errors.filter(
    (e) =>
      e.includes("Cannot update a component") ||
      e.includes("cannot be a descendant") ||
      e.includes("cannot contain a nested"),
  );
  expect(react).toEqual([]);
});
