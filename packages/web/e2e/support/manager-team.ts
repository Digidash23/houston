/**
 * The team step of the AI Manager's onboarding conversation, and its close.
 *
 * The team step opens straight on the starter team: the "Build your team"
 * card's own employee cards, each named for its job and open to change.
 * "Hire one more" adds a card, a draft's Remove lets it go, and "Hire my
 * team" hires everyone (each created behind the person). The finish waits
 * for every hire; the manager then closes on the person's goal: "Yes, let's do it" or "Not now" hands the view to the real chat. A
 * run resumed with AI Employees already hired first offers "Hire one more"
 * or "That's my team".
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { prefilledName } from "./employee-name";
import {
  GOAL_ANSWER,
  managerOnboarding,
  managerStep,
} from "./manager-onboarding";
import { type PressMode, press } from "./mobile-nav";

/** The resumed run's two answers, and the starter team's add button. */
export const HIRE_ONE_MORE = "Hire one more";
export const TEAM_DONE_CHOICE = "That's my team";

/** The starter team's three jobs, in the order the card shows them. */
export const STARTER_ROLES = [
  "Executive assistant",
  "Operations manager",
  "Finance manager",
] as const;

/** The job "Hire one more" deals first: the first shared job no starter
 *  began as. */
export const ADDED_ROLE = "Operations coordinator";

/** The team so far, one row per AI Employee (`data-status` says how the
 *  hire is going: draft, joining, hired or failed). */
export function roster(page: Page): Locator {
  return page.getByTestId("manager-roster");
}

/** The starter team's step. */
export function starterTeam(page: Page): Locator {
  return managerStep(page, "team-basic");
}

/** The name field on an employee card, labelled by the job it was hired for.
 *  It arrives holding that job ("Bookkeeper", numbered when taken). */
export function employeeNameField(scope: Locator, role: string): Locator {
  return scope.getByRole("textbox", { name: `Name (${role})` });
}

/** A resumed run's choice: the team so far over its two buttons. */
export function teamNext(page: Page): Locator {
  return page.getByTestId("manager-team-next");
}

/** On a resumed run: "That's my team" or "Hire one more". */
export async function afterHire(
  page: Page,
  choice: typeof TEAM_DONE_CHOICE | typeof HIRE_ONE_MORE,
  mode: PressMode = "click",
): Promise<void> {
  await press(
    teamNext(page).getByRole("button", { name: choice, exact: true }),
    mode,
  );
}

/** "Hire one more" in the starter team's footer: a card for the next shared
 *  job, on top of the others. */
export async function addStarterCard(
  page: Page,
  mode: PressMode = "click",
): Promise<void> {
  const step = starterTeam(page);
  await press(
    step.getByRole("button", { name: HIRE_ONE_MORE, exact: true }),
    mode,
  );
  await expect(employeeNameField(step, ADDED_ROLE)).toBeVisible();
}

/** A draft card's Remove, by the name its field holds. */
export function removeStarterCard(page: Page, name: string): Locator {
  return starterTeam(page).getByRole("button", {
    name: `Remove ${name}`,
    exact: true,
  });
}

/**
 * Press "Hire my team" on the starter team, whose cards (`roles`, in order)
 * arrive named for their jobs: renamed to `names` first, or hired as they
 * stand when `names` is null. The Manager then starts its closing. Returns
 * the names hired.
 */
export async function hireStarterTeam(
  page: Page,
  names: readonly string[] | null,
  mode: PressMode = "click",
  roles: readonly string[] = STARTER_ROLES,
): Promise<string[]> {
  const step = starterTeam(page);
  await expect(
    step.getByRole("heading", { name: "Meet your new team" }),
  ).toBeVisible();
  await expect(step.getByText(/Everything here is editable/)).toBeVisible();
  const hired: string[] = [];
  for (const [index, role] of roles.entries()) {
    const field = employeeNameField(step, role);
    await expect(field).toHaveValue(prefilledName(role));
    if (names) await field.fill(names[index]);
    hired.push(await field.inputValue());
  }
  await press(step.getByRole("button", { name: "Hire my team" }), mode);
  // The receipt names the team; the Manager goes straight to its closing.
  // With nothing left to ask, the conversation may already be the real
  // chat's, so both are read wherever the conversation is on screen.
  const conversation = managerOnboarding(page).or(
    page.getByTestId("assistant-chat"),
  );
  const list = new Intl.ListFormat("en", { type: "conjunction" }).format(hired);
  await expect(conversation.getByText(list)).toBeVisible({ timeout: 15_000 });
  await expect(
    conversation.getByText("Your team is ready!", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  return hired;
}

/** The manager's closing, once the team is built: separate messages, in
 *  order. What the manager does is told as far as the deployment reaches;
 *  the fake host serves no shared spaces and no integrations. */
export const CLOSING_LINES = [
  "Your team is ready!",
  "Open any of your AI Employees to start their first day of work.",
  "Remember that I'm your AI Manager and I'm here to help. I hand out missions to your AI Employees and hire new ones when you need them.",
] as const;

/** The closing's last message for a person who named a goal. */
export function goalOffer(goal: string = GOAL_ANSWER): string {
  return `You'd love to hand off: “${goal}”. Want me to put an AI Employee on it?`;
}

/** The closing's two answers to the goal offer. */
export const HANDOFF_YES = "Yes, let's do it";
export const HANDOFF_NOT_NOW = "Not now";

/** The goal offer's answer, by its label. */
export function handoffAnswer(page: Page, label: string): Locator {
  return page
    .getByTestId("manager-handoff")
    .getByRole("button", { name: label, exact: true });
}

/** Wait for the closing messages and the offer to start on the goal. */
export async function expectClosing(
  page: Page,
  goal: string = GOAL_ANSWER,
): Promise<void> {
  const chat = managerOnboarding(page);
  for (const line of [...CLOSING_LINES, goalOffer(goal)])
    await expect(chat.getByText(line, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  await expect(handoffAnswer(page, HANDOFF_YES)).toBeVisible();
}

/**
 * Close the conversation once the team is built: wait for the manager's
 * closing and its offer to start on the goal, answer "Not now", and land on
 * the real AI Manager chat, which opens on the conversation just had: its
 * lines were imported as the manager's real history, the offer included.
 */
export async function finishOnboarding(
  page: Page,
  mode: PressMode = "click",
): Promise<void> {
  await expectClosing(page);
  await press(handoffAnswer(page, HANDOFF_NOT_NOW), mode);
  const chat = page.getByTestId("assistant-chat");
  await expect(chat).toBeVisible();
  await expect(managerOnboarding(page)).toHaveCount(0);
  await expect(chat.getByText(goalOffer(), { exact: true })).toBeVisible();
}
