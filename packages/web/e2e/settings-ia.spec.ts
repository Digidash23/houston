import { FAKE_HOST_URL } from "@houston/fake-host";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { AUTH_WEB_URL, E2E_VIEWER, signInAsViewer } from "./support/identity";
import {
  adminHeading,
  assistantRow,
  openAccountScreen,
  openAdmin,
  openSettings,
} from "./support/settings-nav";
import { navRow, screen } from "./support/team-nav";
import {
  openAccountMenu,
  openNavRow,
  openWorkspaceMenu,
  railDestination,
  workspaceMenuTrigger,
} from "./support/workspace-menu";

/**
 * The rail's information architecture, and what Settings is left holding.
 *
 * Six things must hold, and each of them broke a real user path when it
 * didn't:
 *
 * 1. the rail is the team, the AI Manager pinned first and the "Add new AI
 *    Employee" shortcut closing it, with no heading over it; its foot holds
 *    the connect rows (Integrations, AI Models) and the account row, whose
 *    menu holds the workspaces, Admin behind the org gate, the Academy and
 *    Settings, with no Skills row and no help control;
 * 2. two retired destinations hold no rail row: agent policy is reached
 *    through each employee's own screen, and **Time worked** has no screen
 *    of its own. Each is asserted absent from the rail by name, so a
 *    top-level row for either fails here;
 * 3. Settings holds the person's standing setup: the general group everybody
 *    sees, plus Danger. The Context editors live in their own surfaces, so
 *    Settings carries no "Help" / "Context" / "Support" / "Workspace" /
 *    "Team" heading;
 * 4. Admin is a top-level screen opened from the account menu, so its header
 *    strip carries no way back;
 * 5. the rail's Settings entry ALWAYS lands on the index, including from inside
 *    a section — otherwise it is a dead click, since the view is already
 *    `settings`;
 * 6. the person has ONE door: the rail's account row names them over their
 *    workspace, and its menu is headed by them and holds Profile, About me
 *    and Sign out, the first two opening a screen of their own; Settings
 *    carries no identity header, no Sign out, and no Profile or About me row.
 */

/**
 * Teams owner on a gateway that meters running time, so the Skills row exists
 * in the rail (it rides space ownership) and the Admin dashboard is this
 * caller's to open.
 *
 * `computeUsage` is on deliberately even though no screen shows Time worked:
 * this deployment advertises the compute capability, so it is the one that
 * makes the retired row's absence below mean something.
 */
const OWNER_CAPS = {
  multiplayer: true,
  teams: true,
  role: "owner",
  computeUsage: true,
};

async function armOwner(request: APIRequestContext): Promise<void> {
  await request.post(`${FAKE_HOST_URL}/__test__/capabilities`, {
    data: OWNER_CAPS,
  });
}

/** A rail row addressed the way a user reads it. The rows this IA DELETED have
 *  no anchor and no testid left to ask for, so their old label is the only
 *  honest handle for "it must not be back". */
function railButton(page: Page, name: string): Locator {
  return page
    .locator("[data-tour-target='sidebar']")
    .getByRole("button", { name, exact: true });
}

/** An item of an open rail menu, by the name it wears. */
function menuItem(menu: Locator, name: string): Locator {
  return menu.getByRole("menuitem", { name, exact: true });
}

test("the sidebar carries only the IA's top-level entries", async ({
  page,
  request,
}) => {
  await armOwner(request);
  await page.goto("/");

  // The rail is the team: the AI Manager leads it, addressed by its test id,
  // no heading stands above the employees, and the "Add new AI Employee"
  // shortcut closes them.
  const sidebar = page.locator("[data-tour-target='sidebar']");
  await expect(assistantRow(page)).toBeVisible();
  await expect(sidebar.getByText("Your AI Employees")).toHaveCount(0);
  await expect(sidebar.getByText("Workspace", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByTestId("rail-add-employee")).toBeVisible();

  // The connect rows sit on the rail's foot; everything else is the account
  // row's menu: Admin, the Academy and Settings.
  for (const id of ["ai-hub", "integrations"] as const) {
    await expect(navRow(page, id)).toBeVisible();
  }
  const menu = await openWorkspaceMenu(page);
  await expect(menu.getByTestId("rail-admin")).toBeVisible();
  for (const id of ["academy", "settings"] as const) {
    await expect(menu.locator(`[data-tour-target='nav-${id}']`)).toBeVisible();
  }
  for (const id of ["ai-hub", "integrations"] as const) {
    await expect(menu.locator(`[data-tour-target='nav-${id}']`)).toHaveCount(0);
  }

  // The rows this IA deleted, asserted by the names they used to wear, in the
  // menu and on the rail alike. An owner on a compute-metering gateway is the
  // ONE caller who saw them all, so if any comes back it comes back here.
  for (const gone of [
    "Skills",
    "Permissions",
    "Time worked",
    "Help",
    "Report a problem",
  ]) {
    await expect(menuItem(menu, gone)).toHaveCount(0);
    await expect(railButton(page, gone)).toHaveCount(0);
  }
  await page.keyboard.press("Escape");

  // A plain member: the legacy Teams shape, where the sole workspace really
  // is the org.
  await request.post(`${FAKE_HOST_URL}/__test__/capabilities`, {
    data: { multiplayer: true, teams: true, role: "user" },
  });
  await page.goto("/");
  await expect(workspaceMenuTrigger(page)).toBeVisible();

  // Ungated controls are untouched: Integrations, the Academy and Settings
  // are everyone's chrome, and the AI Manager rides discovery rather than a
  // role, so a plain member keeps it. Admin rides the org gate, so it is
  // absent, and the positive signals in the same open menu make that the
  // gate rather than an unpainted menu.
  await expect(assistantRow(page)).toBeVisible();
  await expect(railDestination(page, "nav-integrations")).toBeVisible();
  const memberMenu = await openWorkspaceMenu(page);
  await expect(navRow(page, "settings")).toBeVisible();
  await expect(menuItem(memberMenu, "Academy")).toBeVisible();
  await expect(memberMenu.getByTestId("rail-admin")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The Integrations screen still paints its catalog: that one is everyone's.
  await openNavRow(page, "integrations");
  await expect(
    screen(page).locator("[data-integrations-section='catalog']"),
  ).toBeVisible();

  // Settings keeps no Skills door either: skills live in each employee's own
  // settings. The index is painted (its Keyboard shortcuts row stands) before
  // the absence is read.
  await openSettings(page);
  await expect(
    screen(page).getByRole("button", { name: /^Keyboard shortcuts/ }),
  ).toBeVisible();
  await expect(
    screen(page).getByRole("button", { name: /^Skills/ }),
  ).toHaveCount(0);
});

test("Settings holds only settings, under one heading", async ({
  page,
  request,
}) => {
  await armOwner(request);
  await page.goto("/");
  await openSettings(page);

  // Asserted on the group headings themselves (`SettingsCard`'s h2), not on
  // page text: every top-level screen stays MOUNTED behind the open one, so a
  // bare text query would also see another screen's copy.
  const main = page.locator('[data-tour-target="main"]');
  const group = (name: string) =>
    main.getByRole("heading", { level: 2, name, exact: true });
  await expect(group("General")).toBeVisible();
  // The five headings that named things which are not settings. Each died with
  // its rows: what the agents know about the COMPANY opens from Admin's
  // header, Time worked has no screen, and the help-shaped rows sit in General
  // rather than keeping a group of their own.
  for (const heading of ["Help", "Context", "Support", "Workspace", "Team"]) {
    await expect(group(heading)).toHaveCount(0);
  }
  // The moved rows themselves are gone from the index, testid and all — even
  // for an owner, who is exactly who used to see the Team group.
  await expect(page.locator('[data-testid^="settings-row-"]')).toHaveCount(0);
  await expect(main.getByText("Your context")).toHaveCount(0);
  await expect(main.getByText("Workspace context")).toHaveCount(0);
  // The help-shaped rows survived the fold: they sit in General now.
  await expect(main.getByText("Keyboard shortcuts")).toBeVisible();
  await expect(main.getByText("Report bug")).toBeVisible();
  // The person is the account menu's: Settings lists neither Profile nor
  // About me (a row reads its title first, then its description).
  for (const gone of [/^Profile/, /^About me/]) {
    await expect(screen(page).getByRole("button", { name: gone })).toHaveCount(
      0,
    );
  }
});

test.describe("the signed-in person, from the rail's account menu only", () => {
  // The person needs a real session, which the default server cannot mint: it
  // bakes no Firebase key. Same server and sign-in the profile spec uses.
  test.use({ baseURL: AUTH_WEB_URL });

  test("the account menu names the person, holds Sign out and opens their screens", async ({
    page,
    request,
  }) => {
    await armOwner(request);
    await signInAsViewer(page);

    // Settings carries none of the person, even signed in: no name, no email,
    // no Sign out, no Profile or About me row.
    await openSettings(page);
    const main = screen(page);
    await expect(
      main.getByText(E2E_VIEWER.displayName, { exact: true }),
    ).toHaveCount(0);
    await expect(main.getByText(E2E_VIEWER.email, { exact: true })).toHaveCount(
      0,
    );
    await expect(main.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    for (const gone of [/^Profile/, /^About me/]) {
      await expect(main.getByRole("button", { name: gone })).toHaveCount(0);
    }

    // The rail's account row names the person over their workspace; its
    // menu is headed by the person with their email and holds what the
    // account needs, Sign out last.
    const sidebar = page.locator("[data-tour-target='sidebar']");
    await expect(
      workspaceMenuTrigger(page).getByText(E2E_VIEWER.displayName),
    ).toBeVisible();
    const account = await openAccountMenu(page);
    await expect(
      account.getByText(E2E_VIEWER.displayName, { exact: true }),
    ).toBeVisible();
    await expect(
      account.getByText(E2E_VIEWER.email, { exact: true }),
    ).toBeVisible();
    for (const item of ["Profile", "About me", "Sign out"]) {
      await expect(menuItem(account, item)).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(sidebar.getByRole("button", { name: "Sign out" })).toHaveCount(
      0,
    );

    // Profile and About me are screens of their own.
    await openAccountScreen(page, "Profile");
    await expect(page.getByTestId("profile-name-input")).toBeVisible();
    await openAccountScreen(page, "About me");
  });
});

test("Admin opens from its rail row without a back control", async ({
  page,
  request,
}) => {
  await armOwner(request);
  await page.goto("/");

  // A top-level screen, so its header strip leads with the identity lozenge
  // and no way back. Scoped to the screen ON THE GLASS: every top-level view
  // is kept alive, so an unscoped lookup could read another screen's control.
  await openAdmin(page);
  await expect(adminHeading(page)).toBeVisible();
  await expect(
    screen(page)
      .getByTestId("page-header")
      .getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0);
});

test("the sidebar Settings entry returns to the index from inside a section", async ({
  page,
  request,
}) => {
  await armOwner(request);
  await page.goto("/");
  await openSettings(page);

  const main = page.locator('[data-tour-target="main"]');
  const sectionHeading = main.getByRole("heading", {
    name: "Keyboard shortcuts",
  });
  await main.getByText("Keyboard shortcuts").click();
  await expect(sectionHeading).toBeVisible();

  // The view is ALREADY "settings", so this only works because opening Settings
  // clears the open section too — otherwise the click does nothing.
  await openSettings(page);
  await expect(sectionHeading).toHaveCount(0);
});
