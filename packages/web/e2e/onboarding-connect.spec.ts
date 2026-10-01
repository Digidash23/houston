import type { Route } from "@playwright/test";
import {
  showFewerProviders,
  subscriptionCard,
  viewMoreProviders,
} from "./support/connect-ai";
import { expect, test } from "./support/fixtures";
import {
  connectAi,
  connectAiStep,
  managerOnboarding,
  managerStep,
  onboardingPrompt,
  receipt,
} from "./support/manager-onboarding";
import { openManagerOnboarding, resetToFirstRun } from "./support/onboarding";

import { workspaceMenuTrigger } from "./support/workspace-menu";

const CONNECT_WAITING = "Waiting for you to sign in";

/**
 * First run's opening: the AI Manager's conversation, inside the workspace
 * shell, opens with the manager's hello (who it is, what it does, one short
 * message at a time) and starts by connecting an AI. The "Connect your AI" step leads with two
 * subscription cards, Claude and ChatGPT; "View more" swaps them for every
 * provider in one list. Advancement is app state, never a Next button: the
 * conversation moves on to the survey the moment the shared provider probe
 * confirms a connection, and the person's answer reads "Connected <provider>."
 */
test("first run opens the manager's chat in the shell, and connecting comes first", async ({
  page,
  request,
}) => {
  // Onboarding starts when the v3 host reports ZERO agents.
  await resetToFirstRun(request);
  await openManagerOnboarding(page);

  const chat = managerOnboarding(page);
  // The hello, one message per line: signed out, there is no name to greet.
  for (const line of [
    "Hi there!",
    "I'm Houston, your AI Manager. I build and run your team of AI Employees.",
    "Each AI Employee owns one job. They do real work in your tools on their own, and report back when it's done.",
    "You tell me what you need, and I make sure the right AI Employee is on it.",
    "First, let's connect the AI that powers your team.",
  ])
    await expect(chat.getByText(line, { exact: true })).toBeVisible();
  // Inside the shell: the rail stands beside the conversation.
  await expect(workspaceMenuTrigger(page)).toBeVisible();
  // Answered by clicking: the chat has no composer while it runs.
  await expect(chat.locator("textarea")).toHaveCount(0);

  await expect(
    onboardingPrompt(page).getByText("Connect your AI", { exact: true }),
  ).toBeVisible();
  await expect(connectAiStep(page)).toBeVisible();
  await expect(managerStep(page, "survey-industry")).toHaveCount(0);

  await connectAi(page);
  await expect(receipt(page, "Connected OpenRouter.")).toBeVisible();
  await expect(chat.getByText(/^Your AI is connected!/)).toBeVisible();
  await expect(connectAiStep(page)).toHaveCount(0);
});

test("View more swaps the featured cards for every provider and back", async ({
  page,
  request,
}) => {
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await expect(connectAiStep(page)).toBeVisible();

  await expect(subscriptionCard(page, "Claude")).toBeVisible();
  await expect(subscriptionCard(page, "ChatGPT")).toBeVisible();
  await expect(page.getByPlaceholder("Search providers")).toHaveCount(0);

  await viewMoreProviders(page).click();
  // The button pressed is gone, so focus lands on the one that swaps back.
  const showFewer = showFewerProviders(page);
  await expect(showFewer).toBeFocused();
  await expect(page.getByPlaceholder("Search providers")).toBeVisible();
  // The list replaces the featured cards and includes their providers, listed
  // under the company that makes each one.
  await expect(subscriptionCard(page, "Claude")).toHaveCount(0);
  await expect(subscriptionCard(page, "ChatGPT")).toHaveCount(0);
  await page.getByPlaceholder("Search providers").fill("claude");
  await expect(
    page.getByRole("button", { name: "Connect Anthropic" }),
  ).toBeVisible();

  await showFewer.click();
  await expect(page.getByPlaceholder("Search providers")).toHaveCount(0);
  await expect(subscriptionCard(page, "Claude")).toBeVisible();
  await expect(viewMoreProviders(page)).toBeFocused();
});

test("a reload mid-onboarding resumes on the step the user left", async ({
  page,
  request,
}) => {
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await expect(connectAiStep(page)).toBeVisible();

  // Nothing is connected yet: the connect step again.
  await page.reload();
  await expect(connectAiStep(page)).toBeVisible();

  // Connected: a reload lands on the survey, the connection kept as history.
  await connectAi(page);
  await page.reload();
  await expect(managerStep(page, "survey-industry")).toBeVisible();
  await expect(receipt(page, "Connected OpenRouter.")).toBeVisible();
  await expect(connectAiStep(page)).toHaveCount(0);
});

test("the connect card shows at once, before the AI's home has answered", async ({
  page,
  request,
}) => {
  // A new account's first provider probe waits on its AI home starting up.
  // Held here for as long as the spec needs: the card must not wait for it.
  const held: Route[] = [];
  let holding = true;
  await page.route("**/setup-runtime/providers", async (route) => {
    if (holding) held.push(route);
    else await route.continue();
  });
  await resetToFirstRun(request);
  await openManagerOnboarding(page);

  await expect(connectAiStep(page)).toBeVisible();
  const claude = subscriptionCard(page, "Claude");
  await expect(claude).toBeEnabled();
  // Pressed before the probe answers: it reads as connecting at once, and
  // the sign-in itself starts when the probe lands.
  await claude.click();
  await expect(
    connectAiStep(page).getByText(CONNECT_WAITING, { exact: true }),
  ).toBeVisible();

  holding = false;
  for (const route of held.splice(0)) await route.continue();
  await expect(connectAiStep(page)).toBeVisible();
});
