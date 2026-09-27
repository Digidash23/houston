/**
 * The "Build your team" card, which lives in the new-workspace dialog: the
 * door onto it, its two opening choices, and one hire walked from the in-app
 * hire.
 */
import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { prefilledName } from "./employee-name";
import { openMoreMenu, type PressMode, press } from "./mobile-nav";
import { seedAnsweredSurvey } from "./onboarding";
import { workspaceMenuTrigger } from "./workspace-menu";

/** The survey's industry every team-card spec seeds, which the card opens
 *  on. */
export const TEAM_CARD_INDUSTRY = "Manufacturing";

/** The basic team's three starters, in the order the card lists them. */
export const BASIC_TEAM_ROLES = [
  "Executive assistant",
  "Operations manager",
  "Finance manager",
] as const;

/**
 * The job every team-card hire in the specs takes: one of the survey
 * industry's (Manufacturing) own catalog jobs, so it is on the first screen of
 * chips without a search.
 */
export const TEAM_HIRE_ROLE = "Production planner";

/**
 * Boot the seeded shell with the survey answered on the account (the card
 * opens on {@link TEAM_CARD_INDUSTRY}), create a workspace and land on its
 * "Build your team" card: the account menu's "Create workspace" (the rail's
 * foot on a desktop, the More card's head on a phone), a name, then the card the
 * dialog opens once the workspace exists. Returns the dialog around the card.
 */
export async function openNewWorkspaceTeamCard(
  page: Page,
  request: APIRequestContext,
  device: "desktop" | "phone" = "desktop",
): Promise<Locator> {
  await seedAnsweredSurvey(request, TEAM_CARD_INDUSTRY.toLowerCase());
  await page.goto("/");
  // The account row: at the rail's foot, or heading the phone's More card.
  const switcher =
    device === "desktop"
      ? workspaceMenuTrigger(page)
      : (await openMoreMenu(page, "click")).locator(
          '[data-testid="more-account"] button[aria-haspopup="menu"]',
        );
  await switcher.click();
  await page.getByRole("menuitem", { name: "Create workspace" }).click();
  const naming = page.getByRole("dialog", { name: "New workspace" });
  await naming
    .getByRole("textbox", { name: "Workspace name" })
    .fill("Acme Corp");
  await naming
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  const card = page.getByRole("dialog", { name: "Let's build your team" });
  await expect(card).toBeVisible();
  return card;
}

/**
 * Hire ONE AI Employee on the "Build your team" card, from its opening choice
 * or from "Hire another": the industry the survey answered is preselected (so
 * Continue confirms it), a job chip answers the next question outright, the
 * naming card arrives named for the job and is renamed to `name`, and its
 * "Hire" lands the roster. `mode` lets the phone specs tap.
 */
export async function hireOnTeamCard(
  page: Page,
  name: string,
  mode: PressMode = "click",
): Promise<void> {
  await expect(
    page.getByRole("heading", {
      name: "What industry does this AI Employee work in?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: TEAM_CARD_INDUSTRY }),
  ).toHaveAttribute("aria-checked", "true");
  await press(
    page.getByRole("button", { name: "Continue", exact: true }),
    mode,
  );
  await press(
    page.getByRole("radio", { name: TEAM_HIRE_ROLE, exact: true }),
    mode,
  );
  await expect(
    page.getByRole("heading", { name: "Name your AI Employee", exact: true }),
  ).toBeVisible();
  const field = teamCardNameField(page, TEAM_HIRE_ROLE);
  await expect(field).toHaveValue(prefilledName(TEAM_HIRE_ROLE));
  await field.fill(name);
  await press(page.getByRole("button", { name: "Hire", exact: true }), mode);
  await expect(page.getByRole("heading", { name: /^You hired/ })).toBeVisible();
}

/** The team card's first choice: hire one AI Employee at a time. */
export function hireYourTeamOption(page: Page): Locator {
  return page.getByRole("button", { name: /^Hire your team/ });
}

/** The team card's other first choice: the ready-made team of three. */
export function basicTeamOption(page: Page): Locator {
  return page.getByRole("button", { name: /^Start with a basic team/ });
}

/**
 * The name field on an employee card, labelled by the job it was hired for.
 * `.first()` is the caller's call when two cards share a job. It arrives
 * holding the job ({@link prefilledName}); cleared, it shows example names,
 * led by the job when the field has room for it whole ("e.g. Executive
 * assistant, Assistant 3, Jerry"), otherwise "e.g. Ava"; required.
 */
export function teamCardNameField(page: Page, role: string): Locator {
  return page.getByRole("textbox", { name: `Name (${role})` });
}

/** Which of the card's two brief lines, as the questions name them. */
export type TeamCardBriefField = "role" | "industry";

/**
 * A card's job or industry line, by the answer it carries: a button named
 * "Change role: <job>". `.first()` is the caller's call when cards share an
 * answer (every starter opens on the survey's industry).
 */
export function teamCardBriefLine(
  page: Page,
  field: TeamCardBriefField,
  answer: string,
): Locator {
  return page.getByRole("button", {
    name: `Change ${field}: ${answer}`,
    exact: true,
  });
}

/** The question a brief line opens: a popover on a desktop, a bottom sheet on
 *  a phone, named for the fact it changes. */
export function teamCardBriefPicker(
  page: Page,
  field: TeamCardBriefField,
): Locator {
  return page.getByRole("dialog", {
    name: field === "role" ? "Role" : "Industry",
  });
}
