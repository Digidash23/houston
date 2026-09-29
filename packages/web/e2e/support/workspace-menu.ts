import { expect, type Locator, type Page } from "@playwright/test";
import { moreMenu, moreRow, openMoreMenu } from "./mobile-nav";

/**
 * The desktop rail's foot, under the team: the connect rows (Integrations,
 * AI Models) on the rail itself, then the account row whose ONE menu holds
 * who is signed in, every workspace and creating one, Profile and About me,
 * Admin behind the org gate, the Academy, Settings and Sign out. On the phone
 * the same destinations are rows of the More card, which the same anchors
 * name.
 */

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 768) < 768;
}

/** The desktop rail. */
function railRoot(page: Page): Locator {
  return page.locator("[data-tour-target='sidebar']");
}

/** The destinations the desktop rail draws on itself: the connect rows.
 *  Every other destination is an item of the account row's menu. */
const ON_THE_RAIL = new Set(["nav-integrations", "nav-ai-hub"]);

/** The account row at the rail's foot: the menu's trigger. */
export function workspaceMenuTrigger(page: Page): Locator {
  return railRoot(page).locator(
    "[data-tour-target='workspaceMenu'] button[aria-haspopup='menu']",
  );
}

/** The open account menu. */
export function workspaceMenu(page: Page): Locator {
  return page.getByRole("menu");
}

/** Open the account row's menu at the rail's foot and wait for it. */
export async function openWorkspaceMenu(page: Page): Promise<Locator> {
  await workspaceMenuTrigger(page).click();
  const menu = workspaceMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

/** The account menu's trigger: the rail's account row, or the account row
 *  of the phone's More card (open that card first). */
export function accountMenuTrigger(page: Page): Locator {
  return isPhone(page)
    ? moreMenu(page).getByTestId("more-account")
    : workspaceMenuTrigger(page);
}

/** Open the account menu (through the More card on the phone). */
export async function openAccountMenu(page: Page): Promise<Locator> {
  if (isPhone(page)) {
    await openMoreMenu(page, "click");
    await accountMenuTrigger(page).click();
    const menu = workspaceMenu(page);
    await expect(menu).toBeVisible();
    return menu;
  }
  return openWorkspaceMenu(page);
}

/** A control the desktop rail carries by its tour anchor: a connect row. */
export function railDestination(page: Page, anchor: string): Locator {
  return railRoot(page).locator(`[data-tour-target='${anchor}']`);
}

/**
 * Where a destination lives, opened and ready to be read: the phone's More
 * card; on the desktop the rail for a connect row, else the account menu. A
 * spec asserting a destination's ABSENCE reads it here, so the absence means
 * the gate and not a closed menu.
 */
export async function openDestinations(
  page: Page,
  anchor: string,
): Promise<Locator> {
  if (isPhone(page)) return openMoreMenu(page, "click");
  if (ON_THE_RAIL.has(anchor)) {
    await expect(railRoot(page)).toBeVisible();
    return railRoot(page);
  }
  return openWorkspaceMenu(page);
}

/** One destination by the tour anchor it carries (`nav-integrations`…). */
export function destinationRow(page: Page, anchor: string): Locator {
  if (isPhone(page)) return moreRow(page, anchor);
  return ON_THE_RAIL.has(anchor)
    ? railDestination(page, anchor)
    : workspaceMenu(page).locator(`[data-tour-target='${anchor}']`);
}

/** Open a destination by its tour anchor, through whatever holds it. */
export async function openDestination(
  page: Page,
  anchor: string,
): Promise<void> {
  await openDestinations(page, anchor);
  await destinationRow(page, anchor).click();
}

/** Open one of the named destinations (`nav-common.ts` `NavRowId`). */
export async function openNavRow(
  page: Page,
  id: "integrations" | "ai-hub" | "academy" | "settings",
): Promise<void> {
  await openDestination(page, `nav-${id}`);
}
