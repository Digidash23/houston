/**
 * The team step of the AI Manager's onboarding conversation, and its close.
 *
 * The team step opens straight on the starter team: the "Build your team"
 * card's own employee cards, each named for its job and open to change.
 * "Hire one more" adds a card, a draft's Remove lets it go, and "Hire my
 * team" hires everyone (each created behind the person). The finish waits
 * for every hire; the manager then closes on the person's goal and opens the
 * real chat. A
 * run resumed with AI Employees already hired first offers "Hire one more"
 * or "That's my team".
 */
import { FAKE_HOST_URL } from "@houston/fake-host";
import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { prefilledName } from "./employee-name";
import {
  GOAL_ANSWER,
  managerOnboarding,
  managerStep,
} from "./manager-onboarding";
import { type PressMode, press } from "./mobile-nav";
import { seedPage } from "./seed";

/** The resumed run's two answers, and the starter team's add button. */
export const HIRE_ONE_MORE = "Hire one more";
export const TEAM_DONE_CHOICE = "That's my team";

/** The starter team's three jobs, in the order the card shows them. */
export const STARTER_ROLES = [
  "Executive assistant",
  "Bookkeeper",
  "Accounts payable clerk",
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

/** The team card the manager closes on, once the team is built. What the
 *  manager does is told as far as the deployment reaches; the fake host
 *  serves no shared spaces and no integrations. */
export const CLOSING_LINES = [
  "Your team is ready!",
  "Open any of your AI Employees to give them work directly.",
] as const;
export const MANAGER_ABILITIES = [
  "Hand out missions",
  "Hire new AI Employees",
] as const;

export function teamCard(scope: Page | Locator): Locator {
  return scope.getByTestId("onboarding-team-card");
}

export function goalCard(scope: Page | Locator): Locator {
  return scope.getByTestId("onboarding-goal-card");
}

/** Wait for the team card in the real chat, then the goal card under it. */
export async function expectClosing(
  page: Page,
  goal: string = GOAL_ANSWER,
): Promise<void> {
  const chat = page.getByTestId("assistant-chat");
  const card = teamCard(chat);
  for (const line of [...CLOSING_LINES, ...MANAGER_ABILITIES])
    await expect(card.getByText(line, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  await expect(goalCard(chat).getByText(`“${goal}”`)).toBeVisible();
}

/**
 * Wait for the real AI Manager chat after the scripted closing and transcript
 * import. The person's goal starts as its first real turn, drawn as the goal
 * card.
 */
export async function finishOnboarding(page: Page): Promise<void> {
  const chat = page.getByTestId("assistant-chat");
  await expect(chat).toBeVisible({ timeout: 15_000 });
  await expect(managerOnboarding(page)).toHaveCount(0);
  await expect(teamCard(chat)).toBeVisible();
  await expect(goalCard(chat)).toBeVisible();
}

/**
 * Hold the closing's save: onboarding finishes only once its conversation is
 * written into the manager's chat, so a held import keeps the person inside
 * onboarding, on the closing, for as long as a spec needs (a reload there).
 * Held by the fake host, never by the browser: a reload cancels a slow
 * request cleanly, but a request the browser pauses outlives it and stalls the
 * reloaded page. The returned release lets every held save through.
 */
export async function holdClosingSave(
  request: APIRequestContext,
): Promise<() => Promise<void>> {
  await request.post(`${FAKE_HOST_URL}/__test__/hold-imports`, {
    data: { hold: true },
  });
  return async () => {
    await request.post(`${FAKE_HOST_URL}/__test__/hold-imports`, {
      data: { hold: false },
    });
  };
}

/**
 * Leave the closing the way a phone evicts a background tab: the document
 * goes with its in-flight requests and none of its handlers run again, then a
 * fresh tab opens on the same origin (same localStorage, same host). The
 * returned page is the one to keep asserting on; the old one is closed.
 *
 * Not `page.reload()`: Chromium aborts the old document's fetches at commit
 * but still runs their rejection handlers, and the closing finishes onboarding
 * on a failed import (use-onboarding-transcript.ts: the import stays owed,
 * finishing never waits), so the dying page stamped `onboarding_completed` and
 * the reload landed in the app. The dev server happened to win that race; the
 * prebuilt bundle CI serves lost it every time.
 */
export async function evictMidClosing(page: Page): Promise<Page> {
  const url = page.url();
  const fresh = await page.context().newPage();
  await seedPage(fresh);
  await page.close();
  await fresh.goto(url);
  return fresh;
}
