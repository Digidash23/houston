import { expect, test } from "./support/fixtures";
import {
  connectAi,
  INDUSTRY_ANSWER,
  managerStep,
  pickChip,
  ROLE_ANSWER,
} from "./support/manager-onboarding";
import { openManagerOnboarding, resetToFirstRun } from "./support/onboarding";

/**
 * The survey's account mirror (`PUT /v1/me/onboarding`): every answer saves
 * on the device first and pushes the whole record in the background, so a
 * push that failed is carried by the next one that lands.
 */

test("an answer whose push failed rides along on the next one", async ({
  page,
  request,
}) => {
  // The account store is a MIRROR of the answers, and a save that lands stamps
  // the whole record as synced. So a push must carry everything the record
  // holds: with a per-answer delta, an industry whose PUT failed was never
  // sent again, and that user's industry was lost to the cohort forever.
  await resetToFirstRun(request);

  const pushed: Array<Record<string, unknown>> = [];
  await page.route("**/v1/me/onboarding", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    pushed.push(JSON.parse(route.request().postData() ?? "{}"));
    // The FIRST push (the industry) never lands.
    await route.fulfill({
      status: pushed.length === 1 ? 503 : 200,
      contentType: "application/json",
      body: "{}",
    });
  });

  await openManagerOnboarding(page);
  await connectAi(page);
  await pickChip(page, "survey-industry", INDUSTRY_ANSWER);
  await pickChip(page, "survey-role", ROLE_ANSWER);
  await expect(managerStep(page, "survey-companySize")).toBeVisible();

  await expect.poll(() => pushed.length).toBeGreaterThanOrEqual(2);
  expect(pushed[0]).toEqual({ industry: "accounting" });
  // The push that DOES land carries the dropped answer with it, and the
  // retired department is never sent.
  expect(pushed.at(-1)).toEqual({ role: "bookkeeper", industry: "accounting" });
});
