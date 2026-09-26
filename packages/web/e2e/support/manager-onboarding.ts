/**
 * The AI Manager's onboarding conversation: its locators, answering a step,
 * connecting an AI and the four survey questions.
 *
 * Every step sits in the chat's composer slot (`manager-onboarding-prompt`,
 * `hidden` while the manager is still typing). A step is one of two things: a
 * step in the create sheet's frame (`manager-step`, keyed by `data-step`):
 * connecting the AI, the industry, the role, the company size, the goal and
 * the starter team, whose chips are `role="radio"` named exactly by their
 * label and whose footer carries Back while the answer before it can change;
 * or plain buttons under the manager's line (a resumed team, the goal offer,
 * the profile's Continue). The team's steps are in
 * `manager-team.ts`.
 * Every spec that walks first run goes through here, so a new step is a
 * one-line change.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { viewMoreProviders } from "./connect-ai";
import { type PressMode, press } from "./mobile-nav";

/** A create-agent step's id (`data-step`). */
export type ManagerStepId =
  | "survey-industry"
  | "survey-role"
  | "survey-companySize"
  | "survey-goal"
  | "team-basic-industry"
  | "team-basic";

/** The survey answers the walk gives: an industry chip, one of its own
 *  roles, a company size, and a goal in the person's words. */
export const INDUSTRY_ANSWER = "Accounting";
export const ROLE_ANSWER = "Bookkeeper";
export const COMPANY_SIZE_ANSWER = "2–10";
export const GOAL_ANSWER = "Chase my overdue invoices every Monday";

/** The two survey questions, as the create sheet's steps ask the person. */
export const INDUSTRY_QUESTION = "What industry do you work in?";
export const ROLE_QUESTION = "What's your role?";
export const COMPANY_SIZE_QUESTION = "How big is your company?";
export const GOAL_QUESTION =
  "Which task would you love to hand off to an AI Employee?";

/** The whole scripted conversation. */
export function managerOnboarding(page: Page): Locator {
  return page.getByTestId("manager-onboarding");
}

/** The composer slot holding the step in hand. */
export function onboardingPrompt(page: Page): Locator {
  return page.getByTestId("manager-onboarding-prompt");
}

/** One create-agent step, by its id. */
export function managerStep(page: Page, id: ManagerStepId): Locator {
  return page.locator(`[data-testid="manager-step"][data-step="${id}"]`);
}

/** The "Connect your AI" step's body (the featured cards / provider list). */
export function connectAiStep(page: Page): Locator {
  return page.getByTestId("manager-connect-ai");
}

/** A catalog chip of a create-agent step, by its exact label. */
export function chip(step: Locator, label: string): Locator {
  return step.getByRole("radio", { name: label, exact: true });
}

/** Answer a create-agent step by picking the chip labelled `label`. */
export async function pickChip(
  page: Page,
  id: ManagerStepId,
  label: string,
  mode: PressMode = "click",
): Promise<void> {
  const step = managerStep(page, id);
  await expect(step).toBeVisible();
  await press(chip(step, label), mode);
}

/** A step's own Continue, which answers again with the pick it holds. */
export function stepContinue(page: Page, id: ManagerStepId): Locator {
  return managerStep(page, id).getByRole("button", {
    name: "Continue",
    exact: true,
  });
}

/** A step's own Back, which reopens the answer before it ("Change answer"
 *  on that answer does the same). */
export function stepBack(page: Page, id: ManagerStepId): Locator {
  return managerStep(page, id).getByRole("button", {
    name: "Back",
    exact: true,
  });
}

/** One company-size bucket, a chip, by its exact label. */
export function companySizeButton(page: Page, label: string): Locator {
  return chip(managerStep(page, "survey-companySize"), label);
}

/** Answer the company size with one tap on the bucket labelled `label`. */
export async function answerCompanySize(
  page: Page,
  mode: PressMode = "click",
  label: string = COMPANY_SIZE_ANSWER,
): Promise<void> {
  await expect(managerStep(page, "survey-companySize")).toBeVisible();
  await press(companySizeButton(page, label), mode);
}

/** The goal question's field. */
export function goalField(page: Page): Locator {
  return managerStep(page, "survey-goal").getByRole("textbox", {
    name: GOAL_QUESTION,
  });
}

/** Answer the goal in the person's words, sent with Continue. */
export async function answerGoal(
  page: Page,
  mode: PressMode = "click",
  goal: string = GOAL_ANSWER,
): Promise<void> {
  const card = managerStep(page, "survey-goal");
  await expect(card).toBeVisible();
  await goalField(page).fill(goal);
  await press(
    card.getByRole("button", { name: "Continue", exact: true }),
    mode,
  );
}

/** One of the person's answers in the conversation, by the answer it shows. */
export function receipt(page: Page, answerText: string | RegExp): Locator {
  return managerOnboarding(page)
    .locator('[data-conversation-message-key^="user-"]')
    .filter({ hasText: answerText });
}

/** "Change answer", under the latest answer only. */
export function changeAnswer(page: Page): Locator {
  return page.getByTestId("manager-change-answer");
}

/**
 * Connect a provider on the "Connect your AI" step through the api-key path
 * (the fake host accepts any key), found in the full list "View more" opens.
 * The conversation moves on by itself once the provider is confirmed
 * connected, landing on the survey's first question.
 */
export async function connectAi(
  page: Page,
  mode: PressMode = "click",
  /** The step connecting leads to: the survey, or the team when the survey
   *  record is already answered. */
  next: ManagerStepId = "survey-industry",
): Promise<void> {
  const step = connectAiStep(page);
  await expect(step).toBeVisible();
  await press(viewMoreProviders(page), mode);
  await step.getByPlaceholder("Search providers").fill("openrouter");
  await press(step.getByRole("button", { name: "Connect OpenRouter" }), mode);
  await page
    .getByPlaceholder("Paste your API key")
    .fill("sk-or-e2e-onboarding");
  await press(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Connect", exact: true }),
    mode,
  );
  await expect(managerStep(page, next)).toBeVisible();
}

/** Answer the four survey questions, landing on the team step. */
export async function answerSurvey(
  page: Page,
  mode: PressMode = "click",
): Promise<void> {
  await pickChip(page, "survey-industry", INDUSTRY_ANSWER, mode);
  await pickChip(page, "survey-role", ROLE_ANSWER, mode);
  await answerCompanySize(page, mode);
  await answerGoal(page, mode);
  await expect(managerStep(page, "team-basic")).toBeVisible();
}

/** Walk first run up to the team step: connect, then the survey. */
export async function reachTeamStep(
  page: Page,
  mode: PressMode = "click",
): Promise<void> {
  await connectAi(page, mode);
  await answerSurvey(page, mode);
}
