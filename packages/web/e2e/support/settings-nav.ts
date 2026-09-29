import { expect, type Locator, type Page } from "@playwright/test";
import { ASSISTANT_COMPOSER } from "./composer";
import { screen } from "./team-nav";
import {
  openAccountMenu,
  openDestination,
  openDestinations,
} from "./workspace-menu";

/** Settings sections, the account menu's screens, and the rail's Assistant
 *  and Admin screens. */

/**
 * The rail's AI Manager row, pinned first in the employees band. Gated on
 * DISCOVERY (`GET /v1/assistant`), not on a role: a deployment that serves
 * none has no row once no onboarding runs in it. It carries no tour anchor.
 */
export function assistantRow(page: Page): Locator {
  // By test id, never by name: the row's label is product copy that moves
  // (`shell:sidebar.assistant`), and an agent may carry the same name.
  return page.getByTestId("rail-assistant");
}

/**
 * Open the personal assistant from the rail: a 1-on-1 chat owning the whole
 * window, so there is no back bar, no panel header and nothing to drill into.
 * The COMPOSER is therefore the landing — a 1-on-1 chat opens on the place the
 * user types, and it is the one part of the surface that stands whether the
 * thread is empty or already long.
 */
export async function openAssistant(page: Page): Promise<void> {
  await assistantRow(page).click();
  await expect(screen(page).getByPlaceholder(ASSISTANT_COMPOSER)).toBeVisible();
}

/**
 * The gated Admin item of the rail's account menu (a row of the phone's More
 * card), OPENED first so a spec asserting its absence reads the gate, not a
 * closed menu.
 */
export async function adminRow(page: Page): Promise<Locator> {
  const menu = await openDestinations(page, "rail-admin");
  return menu.getByTestId("rail-admin");
}

/**
 * The Admin dashboard's identity heading — the `<h1>` inside the header
 * cluster (`teams:org.title` = "Workspace").
 */
export function adminHeading(page: Page): Locator {
  return screen(page).getByRole("heading", { name: "Workspace", level: 1 });
}

/**
 * Open Admin through the rail's account menu or the phone More card. A first
 * visit lands on the Org chart, which the identity lozenge stands for; Admin
 * is kept alive, so a later visit comes back on the section it was left on.
 */
export async function openAdmin(page: Page): Promise<void> {
  await (await adminRow(page)).click();
  await expect(screen(page)).toHaveAttribute("data-screen", "admin");
  await expect(adminHeading(page)).toBeVisible();
}

/** The account menu's screens: the item each one wears and its view id. */
const ACCOUNT_SCREENS = {
  Profile: "profile",
  "About me": "about-me",
} as const;

/**
 * Open one of the account menu's screens the way a user reaches it: the
 * account row at the rail's foot (the "Your account" row of the phone's More
 * card), then the item by name. They are top-level screens with no level
 * above, so the screen's id and its own `<h1>` prove it landed. Profile is
 * offered only with a signed-in identity whose profile the deployment serves.
 */
export async function openAccountScreen(
  page: Page,
  name: keyof typeof ACCOUNT_SCREENS,
): Promise<void> {
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name, exact: true }).click();
  await expect(screen(page)).toHaveAttribute(
    "data-screen",
    ACCOUNT_SCREENS[name],
  );
  await expect(
    screen(page).getByRole("heading", { name, level: 1 }),
  ).toBeVisible();
}

/** Open About me: the standing context every agent loads about the PERSON. */
export async function openAboutMe(page: Page): Promise<void> {
  await openAccountScreen(page, "About me");
}

/**
 * The sections of the Admin header cluster, as it labels them
 * (`teams:org.tabs.*`). A personal space shows the Org chart alone.
 */
export type AdminSection = "Org chart" | "People" | "Billing" | "Activity";

/** Section name -> the `data-admin-section-tab` value its lozenge carries. */
export const ADMIN_SECTION_TAB_IDS: Readonly<Record<AdminSection, string>> = {
  "Org chart": "orgChart",
  People: "people",
  Billing: "billing",
  Activity: "activity",
};

/** One section lozenge of the Admin header cluster, by section. */
export function adminSectionTab(page: Page, name: AdminSection): Locator {
  return screen(page).locator(
    `[data-admin-section-tab='${ADMIN_SECTION_TAB_IDS[name]}']`,
  );
}

/** The phone's replacement for the full Admin section cluster. */
function adminSectionSwitcher(page: Page): Locator {
  return screen(page).locator("[data-admin-section-switcher]");
}

/**
 * Assert exactly which sections Admin offers, in either layout.
 *
 * Reading the WHOLE cluster is what makes an absence meaningful: on the phone
 * the lozenges live in a closed menu, so a bare "this section's lozenge has
 * count 0" would pass on every collapsed header whatever the space's gates
 * say.
 */
export async function expectAdminSections(
  page: Page,
  names: readonly AdminSection[],
): Promise<void> {
  const tabs = screen(page).locator("[data-admin-section-tab]");
  if (await tabs.first().isVisible()) {
    await expect(tabs).toHaveCount(names.length);
    for (const name of names)
      await expect(adminSectionTab(page, name)).toBeVisible();
    return;
  }

  const switcher = adminSectionSwitcher(page);
  await expect(switcher).toBeVisible();
  await switcher.click();
  const menuSections = page.locator(
    "[role='menuitemcheckbox'][data-admin-section-tab]",
  );
  await expect(menuSections).toHaveCount(names.length);
  for (const name of names) {
    await expect(
      page.locator(
        `[role='menuitemcheckbox'][data-admin-section-tab='${ADMIN_SECTION_TAB_IDS[name]}']`,
      ),
    ).toBeVisible();
  }
  await page.keyboard.press("Escape");
}

/**
 * Open Admin on one of its sections.
 *
 * The sections are lozenges in the header cluster (the shared grammar with the
 * employee screen), addressed by their `data-admin-section-tab` id so the helper
 * survives label changes. The landing waits on the BODY's
 * `data-admin-section-body` marker, not just the lozenge's `aria-current`: the
 * lozenge repaints synchronously on click, so only the body attribute proves
 * the section actually swapped in before a spec's first assertion runs.
 */
export async function openAdminSection(
  page: Page,
  name: AdminSection,
): Promise<void> {
  await openAdmin(page);
  const id = ADMIN_SECTION_TAB_IDS[name];
  const tab = adminSectionTab(page, name);
  if (await tab.isVisible()) {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-current", "page");
  } else {
    // Phone: the cluster is a menu, so the section is picked from inside it.
    await adminSectionSwitcher(page).click();
    await page
      .locator(`[role='menuitemcheckbox'][data-admin-section-tab='${id}']`)
      .click();
  }
  await expect(
    screen(page).locator(`[data-admin-section-body='${id}']`),
  ).toBeVisible();
}

/**
 * The Admin header's Company context pill (`teams:org.companyContext.title`).
 * A header tool rather than a section, so it stands in every space and over
 * every section; its sheet renders in a portal, outside the screen.
 */
export function companyContextButton(page: Page): Locator {
  return screen(page).locator("[data-company-context-trigger]");
}

/** Open Admin, then the Company context sheet from the header pill. */
export async function openCompanyContext(page: Page): Promise<Locator> {
  await openAdmin(page);
  await companyContextButton(page).click();
  const sheet = page.getByRole("dialog", { name: "Company context" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * Open the Settings index and wait for it to be on screen, through the rail's
 * account menu (the phone's More card), by its `nav-settings` anchor.
 *
 * The wait is what makes a "this row is absent" assertion meaningful: without it
 * the absence could just be the index not painted yet.
 */
export async function openSettings(page: Page): Promise<void> {
  await openDestination(page, "nav-settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
}
