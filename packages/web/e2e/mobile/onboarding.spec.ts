import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import {
  answerCompanySize,
  answerGoal,
  answerSurvey,
  companySizeButton,
  connectAi,
  connectAiStep,
  goalField,
  INDUSTRY_ANSWER,
  managerOnboarding,
  managerStep,
  pickChip,
  ROLE_ANSWER,
} from "../support/manager-onboarding";
import {
  evictMidClosing,
  finishOnboarding,
  HIRE_ONE_MORE,
  hireStarterTeam,
  holdClosingSave,
  roster,
  STARTER_ROLES,
  starterTeam,
  teamNext,
} from "../support/manager-team";
import { awaitAgentsHome, navBar } from "../support/mobile-nav";
import { openManagerOnboarding, resetToFirstRun } from "../support/onboarding";
import {
  expectLatestLinesClearOfStep,
  scrollLogToStart,
} from "../support/onboarding-scroll";

/**
 * First run on a phone, end to end: the AI Manager's conversation full-screen
 * (its own back header, no nav bar under it), connecting an AI, the survey,
 * the starter team, and then the app. This is the tier-1 gate that keeps the phone
 * from dead-ending a new user in a mandatory onboarding they cannot finish.
 */

/** Zero horizontal overflow: the phone layout's standing rule. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A control sized for the thumb: most of the phone's width. */
async function expectFullWidth(page: Page, control: Locator) {
  const box = await control.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("the control did not lay out");
  expect(box.width).toBeGreaterThan(viewport.width * 0.7);
}

/** A field a phone does not zoom into on focus: 16px text or more. */
async function expectNoZoomOnFocus(field: Locator) {
  const size = await field.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).fontSize),
  );
  expect(size).toBeGreaterThanOrEqual(16);
}

test("first run completes on a phone: connect, survey, first hire, the app", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await resetToFirstRun(request);
  await openManagerOnboarding(page);

  // The conversation is a pushed chat: its own way back, no nav bar.
  await expect(
    managerOnboarding(page).getByTestId("assistant-back"),
  ).toBeVisible();
  await expect(navBar(page)).toHaveCount(0);
  await expect(connectAiStep(page)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await connectAi(page, "tap");

  // The industry: the create sheet's step, its filter and "Something else"
  // stacked full width for the thumb, the filter never zooming the page.
  const industry = managerStep(page, "survey-industry");
  const search = industry.getByPlaceholder("Search industries");
  await expectFullWidth(page, search);
  await expectNoZoomOnFocus(search);
  await expectFullWidth(
    page,
    industry.getByRole("button", { name: "Something else" }),
  );
  await expectNoHorizontalOverflow(page);
  // The step fills most of the phone, and the manager's line stays above it.
  await expectLatestLinesClearOfStep(page);
  await pickChip(page, "survey-industry", INDUSTRY_ANSWER, "tap");
  await expectLatestLinesClearOfStep(page);
  // A reader scrolled back through the history still sees their answer land,
  // the way a sent message brings the real chat down.
  await scrollLogToStart(page);
  await pickChip(page, "survey-role", ROLE_ANSWER, "tap");
  await expectLatestLinesClearOfStep(page);

  // The company size: thumb-sized chips wrapping in a row, one tap to answer.
  const [small, next] = await Promise.all([
    companySizeButton(page, "Just me").boundingBox(),
    companySizeButton(page, "2–10").boundingBox(),
  ]);
  if (!small || !next) throw new Error("the buckets did not lay out");
  expect(small.height).toBeGreaterThanOrEqual(44);
  expect(next.y).toBe(small.y);
  expect(next.x).toBeGreaterThan(small.x);
  await expectNoHorizontalOverflow(page);
  await answerCompanySize(page, "tap");
  await expectLatestLinesClearOfStep(page);

  // The goal: a field that never zooms, with a thumb-sized Continue and no
  // way to skip it.
  await expectNoZoomOnFocus(goalField(page));
  const goal = managerStep(page, "survey-goal");
  await expectFullWidth(page, goal.getByRole("button", { name: "Continue" }));
  await expect(goal.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await goalField(page).focus();
  await expectLatestLinesClearOfStep(page);
  await answerGoal(page, "tap");
  await expectNoHorizontalOverflow(page);
  await expectLatestLinesClearOfStep(page);

  // The starter team, renamed and hired in one tap.
  await hireStarterTeam(page, ["Avery", "Felix", "Nora"], "tap", STARTER_ROLES);
  await expectNoHorizontalOverflow(page);
  await finishOnboarding(page);

  // The real chat's back chevron leaves for the Agents home, with the hires.
  await page.getByTestId("assistant-back").tap();
  await expect(navBar(page)).toBeVisible();
  const row = await awaitAgentsHome(page);
  await expect(row).toContainText("Avery");
  await expectNoHorizontalOverflow(page);
});

test("the starter team's buttons are sized for the thumb", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await connectAi(page, "tap");
  await answerSurvey(page, "tap");
  const step = starterTeam(page);
  const hire = step.getByRole("button", { name: "Hire my team" });
  expect((await hire.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expectFullWidth(page, hire);
  const more = step.getByRole("button", { name: HIRE_ONE_MORE, exact: true });
  expect((await more.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const remove = step.getByRole("button", {
    name: `Remove ${STARTER_ROLES[0]}`,
    exact: true,
  });
  expect((await remove.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
  // The manager's latest line stays in view above the team.
  await expectLatestLinesClearOfStep(page);
});

test("a reload mid-onboarding resumes on the step the user left", async ({
  page,
  request,
}) => {
  // Phones evict a background tab: leaving to fetch a sign-in code and coming
  // back reloads the app. The run must re-enter on the step it stood on, never
  // at the start with the work so far forgotten, and never in the app early.
  test.setTimeout(90_000);
  await resetToFirstRun(request);
  await openManagerOnboarding(page);
  await expect(connectAiStep(page)).toBeVisible();

  await page.reload();
  await expect(connectAiStep(page)).toBeVisible();

  // Hiring flips the zero-agent first-run signal; the pending stage still
  // holds the person on the team step across a reload.
  await connectAi(page, "tap");
  await answerSurvey(page, "tap");
  // Held so the eviction lands on the closing, before onboarding finishes.
  const release = await holdClosingSave(request);
  await hireStarterTeam(page, null, "tap", STARTER_ROLES);
  const resumed = await evictMidClosing(page);
  await release();
  await expect(teamNext(resumed)).toBeVisible();
  await expect(roster(resumed).locator('li[data-status="hired"]')).toHaveCount(
    3,
  );
  await expect(navBar(resumed)).toHaveCount(0);
});
