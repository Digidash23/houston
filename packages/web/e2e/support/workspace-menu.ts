import { expect, type Locator, type Page } from "@playwright/test";
import { moreRow, openMoreMenu } from "./mobile-nav";

/**
 * The rail's foot and the one menu it opens: every workspace, then Admin, AI
 * Models and Integrations, then the Academy and Settings. On the phone the
 * same destinations are rows of the More card, which the same anchors name.
 */

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 768) < 768;
}

/** The account row at the rail's foot: the workspace menu's trigger. */
export function workspaceMenuTrigger(page: Page): Locator {
  return page.locator(
    "[data-tour-target='sidebar'] [data-tour-target='workspaceMenu'] button[aria-haspopup='menu']",
  );
}

/** The open workspace menu. */
export function workspaceMenu(page: Page): Locator {
  return page.getByRole("menu");
}

/** Open the workspace menu at the rail's foot and wait for it. */
export async function openWorkspaceMenu(page: Page): Promise<Locator> {
  await workspaceMenuTrigger(page).click();
  const menu = workspaceMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * The menu (desktop) or More card (phone) a destination row lives in, opened.
 * A spec asserting a row's ABSENCE opens it first, so the absence means the
 * gate and not a closed menu.
 */
export async function openDestinations(page: Page): Promise<Locator> {
  return isPhone(page) ? openMoreMenu(page, "click") : openWorkspaceMenu(page);
}

/** One destination row by the tour anchor it carries (`nav-integrations`…). */
export function destinationRow(page: Page, anchor: string): Locator {
  return isPhone(page)
    ? moreRow(page, anchor)
    : workspaceMenu(page).locator(`[data-tour-target='${anchor}']`);
}

/** Open a destination by its tour anchor, through the menu that holds it. */
export async function openDestination(
  page: Page,
  anchor: string,
): Promise<void> {
  await openDestinations(page);
  await destinationRow(page, anchor).click();
}

/** Open one of the named destinations (`nav-common.ts` `NavRowId`). */
export async function openNavRow(
  page: Page,
  id: "integrations" | "ai-hub" | "settings",
): Promise<void> {
  await openDestination(page, `nav-${id}`);
}
