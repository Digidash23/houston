import { FAKE_HOST_URL } from "@houston/fake-host";
import { expect, test } from "../support/fixtures";
import {
  moreMenu,
  moreRow,
  navItem,
  openMoreMenu,
} from "../support/mobile-nav";
import { screen } from "../support/team-nav";

/**
 * The phone's More menu: the card the nav bar raises for everything outside the
 * AI Employees tree.
 *
 * It holds the desktop rail's foot: a workspace switcher heading it (the
 * choices the rail's account menu offers), the same connect group
 * (`ConnectGroup`), then the account menu's destinations as rows (the
 * account, Admin, the Academy, Settings), built by the same builders, so
 * this spec guards the things that
 * could drift — the list the seeded single-player deployment actually offers,
 * and the rail's tour anchors resolving to these controls — plus the rule that
 * picking one closes the menu instead of leaving it floating over the screen
 * it opened.
 */

test("More opens the card and closes again without navigating", async ({
  page,
}) => {
  await page.goto("/");

  const menu = await openMoreMenu(page);
  await expect(
    menu.getByRole("button", { name: "Connect your apps" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(moreMenu(page)).toBeHidden();
  // Dismissing a menu is not a navigation: the screen behind it is untouched.
  await expect(screen(page)).toHaveAttribute("data-screen", "agents-home");
  await expect(navItem(page, "agents")).toHaveAttribute("aria-current", "page");
});

test("the menu lists what this deployment offers, with the rail's anchors", async ({
  page,
}) => {
  await page.goto("/");
  const menu = await openMoreMenu(page);

  for (const label of ["Connect your apps", "Connect your AI"]) {
    await expect(
      menu.getByRole("button", { name: label, exact: true }),
      `"${label}" should be a row of the More menu's connect group`,
    ).toBeVisible();
  }

  // The single-player seed is below the org gate, so Admin has no row.
  await expect(menu.getByTestId("rail-admin")).toHaveCount(0);

  // The connect rows and the other rows carry the RAIL's own attributes, so
  // one anchor names the same destination on both breakpoints.
  for (const anchor of [
    "nav-integrations",
    "nav-ai-hub",
    "nav-academy",
    "nav-settings",
  ]) {
    await expect(
      moreRow(page, anchor),
      `the menu should carry the "${anchor}" anchor`,
    ).toHaveCount(1);
  }
  // Skills live in each employee's settings: no row for them here.
  await expect(
    menu.getByRole("button", { name: "Skills", exact: true }),
  ).toHaveCount(0);

  // The footer cluster holds destinations only: no help group.
  await expect(
    menu.getByRole("button", { name: "Report a problem" }),
  ).toHaveCount(0);
  await expect(menu.getByText("Help", { exact: true })).toHaveCount(0);
});

test("Admin appears in More only for an admitted caller", async ({
  page,
  request,
}) => {
  await request.post(`${FAKE_HOST_URL}/__test__/capabilities`, {
    data: { multiplayer: true, teams: true, role: "owner" },
  });
  await page.goto("/");
  const menu = await openMoreMenu(page);
  await expect(menu.getByTestId("rail-admin")).toHaveCount(1);
  await menu.getByTestId("rail-admin").tap();
  await expect(moreMenu(page)).toBeHidden();
  await expect(screen(page)).toHaveAttribute("data-screen", "admin");

  // The phone keeps Admin's Company context pill too: the strip holds the
  // section switcher, so the pill takes the row below it and opens its editor
  // as a bottom sheet.
  await screen(page).locator("[data-company-context-trigger]").tap();
  await expect(
    page.getByRole("dialog", { name: "Company context" }),
  ).toBeVisible();
});

test("the account's destinations follow the connect rows, in the rail's order", async ({
  page,
}) => {
  await page.goto("/");
  const menu = await openMoreMenu(page);
  const ys: number[] = [];
  for (const row of [
    moreRow(page, "nav-ai-hub"),
    menu.getByTestId("more-account"),
    moreRow(page, "nav-academy"),
    moreRow(page, "nav-settings"),
  ]) {
    const box = await row.boundingBox();
    if (!box) throw new Error("the card is not laid out");
    ys.push(box.y);
  }
  expect(ys).toEqual([...ys].sort((a, b) => a - b));

  // The account row opens the person's menu. The single-player seed has no
  // identity, so it holds About me alone: no header, no Sign out.
  await menu.getByTestId("more-account").tap();
  const account = page.getByRole("menu");
  await expect(
    account.getByRole("menuitem", { name: "About me", exact: true }),
  ).toBeVisible();
  await expect(account.getByRole("menuitem", { name: "Sign out" })).toHaveCount(
    0,
  );

  // About me is a screen of its own: the card steps aside and the screen
  // takes the glass, headed by its own title.
  await account.getByRole("menuitem", { name: "About me", exact: true }).tap();
  await expect(moreMenu(page)).toBeHidden();
  await expect(screen(page)).toHaveAttribute("data-screen", "about-me");
  await expect(
    screen(page).getByRole("heading", { name: "About me", level: 1 }),
  ).toBeVisible();
});

test("the Settings row opens the settings index", async ({ page }) => {
  await page.goto("/");
  await openMoreMenu(page);

  await moreRow(page, "nav-settings").tap();
  await expect(moreMenu(page)).toBeHidden();
  await expect(screen(page)).toHaveAttribute("data-screen", "settings");
  // The INDEX, never a leftover section: its own groups are on the glass.
  await expect(
    screen(page).getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(screen(page).getByText("General")).toBeVisible();
});

test("a connect row lands on its screen and closes the menu", async ({
  page,
}) => {
  await page.goto("/");
  await openMoreMenu(page);

  await moreRow(page, "nav-integrations").tap();
  await expect(moreMenu(page)).toBeHidden();
  await expect(screen(page)).toHaveAttribute(
    "data-screen",
    "integrations-home",
  );
  await expect(navItem(page, "more")).toHaveAttribute("aria-current", "page");
});

test("the workspace switcher heads the card and switches workspace from its menu", async ({
  page,
}) => {
  await page.goto("/");
  const menu = await openMoreMenu(page);
  const switcher = menu.getByTestId("more-workspace-switcher");
  await expect(switcher).toHaveAttribute("aria-haspopup", "menu");
  await expect(switcher).toBeVisible();
  // It heads the card: nothing in the card sits above it.
  const switcherBox = await switcher.boundingBox();
  const firstRow = await moreRow(page, "nav-integrations").boundingBox();
  if (!switcherBox || !firstRow) throw new Error("the card is not laid out");
  expect(switcherBox.y + switcherBox.height).toBeLessThanOrEqual(firstRow.y);

  // Its menu is the workspace run: the current one checked, then create.
  await switcher.tap();
  await expect(
    page.getByRole("menuitemcheckbox", { checked: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("menuitem").last()).toHaveText(
    "Create workspace",
  );
});
