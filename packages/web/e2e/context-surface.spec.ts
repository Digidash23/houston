import { FAKE_HOST_URL } from "@houston/fake-host";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { openAboutMe, openCompanyContext } from "./support/settings-nav";
import { screen } from "./support/team-nav";

/**
 * The standing context every agent loads before it starts a turn — and the two
 * homes it has, one per OWNER of the words.
 *
 *  - **About me** — what the agents know about the PERSON. They set it once
 *    about themselves, so it is one of the account menu's screens, beside
 *    their Profile. It is ungated: it exists in every deployment, including a
 *    solo desktop install.
 *  - **Company context** — what the agents know about the COMPANY. It is
 *    shared by everyone in the space, so it is the space owner's: a pill in
 *    the Admin header opening its editor in a sheet, available to a
 *    multiplayer team owner or admin and in a Spaces personal space. A solo
 *    install has no org read.
 *
 * The underlying data did not move: each half still reads and writes its own
 * slot of the same blob (`WORKSPACE.md` / `USER.md` locally, the org+user blobs
 * in cloud) through `use-workspace-context`.
 */

/** Teams owner on a non-spaces host: the sole workspace is the org, so the
 *  Admin dashboard (and with it Company context) is theirs. */
async function armOwner(request: APIRequestContext): Promise<void> {
  await request.post(`${FAKE_HOST_URL}/__test__/capabilities`, {
    data: { multiplayer: true, teams: true, role: "owner" },
  });
}

async function seedEmptyContext(page: Page) {
  await page.route(/\/v1\/(workspace|user)-context$/, async (route) => {
    await route.fulfill({ json: { content: "" } });
  });
}

test("About me is the account menu's own screen", async ({ page }) => {
  // No capabilities armed: a plain single-player install, which is exactly
  // where this half has to exist — it is the whole of the product's standing
  // context there.
  await seedEmptyContext(page);
  await page.goto("/");
  await openAboutMe(page);

  await expect(
    screen(page).getByText(
      "What every AI Employee knows about you before it starts.",
    ),
  ).toBeVisible();
  // No invite empty state on a standing-context page: the editor is already
  // open, and the greyed suggestion — which names the PERSON, not the
  // company — is the invitation.
  await expect(screen(page).getByText(/I'm Juan/)).toBeVisible();

  // A top-level screen with no level above: no back bar to Settings.
  await expect(
    screen(page).getByRole("button", { name: "Settings" }),
  ).toHaveCount(0);
});

test("Company context opens from the Admin header, editing the workspace's half", async ({
  page,
  request,
}) => {
  await armOwner(request);
  await seedEmptyContext(page);
  await page.goto("/");
  const sheet = await openCompanyContext(page);

  // The sheet names itself and what belongs in it, since no section does.
  await expect(
    sheet.getByText(
      "What all your AI Employees know on every task and routine they run.",
    ),
  ).toBeVisible();

  // The WORKSPACE slot: the editor is already open (no invite empty state),
  // and its greyed suggestion is a short 3-part example RENDERED as real
  // headings (the overlay is aria-hidden decoration, so it is asserted as
  // text, never by role): the words appear, the "##" syntax never does.
  const editor = sheet.getByRole("textbox");
  await expect(sheet.getByText("Who we are")).toBeVisible();
  await expect(sheet.getByText("How we communicate")).toBeVisible();
  await expect(sheet.getByText("## Who we are")).toHaveCount(0);

  // And only that half. The person's context is not duplicated inside the Admin
  // dashboard — it is theirs, not the admin's, which is the whole reason the two
  // split.
  await expect(editor).toHaveCount(1);
  await expect(sheet.getByText(/I'm Juan/)).toHaveCount(0);

  // A tool over the page, not a section of it: closing the sheet returns to
  // the Org chart, which the identity lozenge ("Workspace") still marks as
  // the current section. The modal sheet hides the page from the
  // accessibility tree while open, so the lozenge is read after it closes.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(
    screen(page).locator("[data-admin-section-body='orgChart']"),
  ).toBeVisible();
  await expect(
    screen(page).getByRole("button", { name: "Workspace", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
