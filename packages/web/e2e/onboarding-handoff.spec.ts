import { FAKE_HOST_URL } from "@houston/fake-host";
import { ASSISTANT_COMPOSER } from "./support/composer";
import { expect, test } from "./support/fixtures";
import {
  connectAi,
  managerOnboarding,
  reachTeamStep,
} from "./support/manager-onboarding";
import {
  CLOSING_LINES,
  expectClosing,
  goalOffer,
  HANDOFF_YES,
  handoffAnswer,
  hireStarterTeam,
} from "./support/manager-team";
import {
  openManagerOnboarding,
  resetToFirstRun,
  SURVEY_PREF_KEY,
  setAccountPreference,
} from "./support/onboarding";

/**
 * How first run ends, once the team is built: the manager closes one message
 * at a time (the team is ready, the AI Employees wait to be opened, what the
 * manager does), then offers to start on the goal the person gave. "Yes,
 * let's do it" finishes onboarding and sends the manager its first real turn,
 * the person's answer as their bubble over the instruction it reads with it;
 * "Not now" only finishes (onboarding-team.spec.ts). A person who skipped the
 * goal is asked for a task instead, and the real chat takes over on its own.
 */

const CLOSING_ASK =
  "What's a task you'd normally do yourself? Tell me and I'll get it done.";

test("Yes, let's do it hands the goal to the manager as its first real turn", async ({
  page,
  request,
}) => {
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await reachTeamStep(page);
  await hireStarterTeam(page, null);
  await expectClosing(page);
  await handoffAnswer(page, HANDOFF_YES).click();

  // The real chat opens on the conversation just had, then the answer.
  const chat = page.getByTestId("assistant-chat");
  await expect(chat).toBeVisible();
  await expect(managerOnboarding(page)).toHaveCount(0);
  await expect(chat.getByText(goalOffer(), { exact: true })).toBeVisible();
  const sent = chat.locator('[data-conversation-message-key^="user-"]');
  await expect(sent.filter({ hasText: HANDOFF_YES })).toBeVisible();
  await expect(sent.filter({ hasText: "Written by Houston" })).toHaveCount(0);

  // The manager answers what it read: the fake host echoes the prompt, which
  // is the instruction behind the person's answer.
  await expect(
    chat.getByText(/Roger that\. You said: "\[Written by Houston/),
  ).toBeVisible({ timeout: 15_000 });
});

test("an account that skipped the goal before it was required gets asked for a task, and the real chat takes over", async ({
  page,
  request,
}) => {
  // The goal cannot be skipped any more; a record from before still can hold
  // a skip, and the survey counts it as answered.
  await resetToFirstRun(request);
  await setAccountPreference(
    request,
    SURVEY_PREF_KEY,
    JSON.stringify({
      version: 2,
      segment: null,
      role: "bookkeeper",
      roleOther: null,
      industry: "accounting",
      industryOther: null,
      companySize: "2_10",
      automationGoal: null,
      goalSkipped: true,
      completionPromptDismissed: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      gatewaySyncedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  await openManagerOnboarding(page);
  await connectAi(page, "click", "team-basic");
  await hireStarterTeam(page, null);

  // Nothing to answer: the chat is the manager's, composer ready to type in.
  const chat = page.getByTestId("assistant-chat");
  await expect(chat).toBeVisible({ timeout: 15_000 });
  await expect(managerOnboarding(page)).toHaveCount(0);
  for (const line of [...CLOSING_LINES, CLOSING_ASK])
    await expect(chat.getByText(line, { exact: true })).toBeVisible();
  await expect(chat.getByPlaceholder(ASSISTANT_COMPOSER)).toBeFocused();
});

test("the closing promises connecting tools only where the deployment connects them", async ({
  page,
  request,
}) => {
  await request.post(`${FAKE_HOST_URL}/__test__/capabilities`, {
    data: { integrations: ["composio"] },
  });
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await reachTeamStep(page);
  await hireStarterTeam(page, null);

  await expect(
    managerOnboarding(page).getByText(
      "Remember that I'm your AI Manager and here to help. I hand out missions to your AI Employees, hire new ones when you need them and connect the tools they need.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(handoffAnswer(page, HANDOFF_YES)).toBeVisible();
});
