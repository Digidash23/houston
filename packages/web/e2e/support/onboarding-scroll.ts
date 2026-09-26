/**
 * The onboarding conversation never hides its latest lines under the step in
 * hand: the newest line sits whole inside the log, above the composer slot
 * the step fills, and no recent line is ever under the step. The log settles on
 * its latest line with a short spring, hence the poll. An answer is the
 * person's send: it brings the latest line back even to a reader scrolled up.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { managerOnboarding, onboardingPrompt } from "./manager-onboarding";

interface Clearance {
  /** The line's top is inside the log's scroll pane. */
  inView: boolean;
  /** The line ends above the step's top edge. */
  aboveStep: boolean;
}

async function clearance(
  line: Locator,
  pane: Locator,
  step: Locator,
): Promise<Clearance | null> {
  const [lineBox, paneBox, stepBox] = await Promise.all([
    line.boundingBox(),
    pane.boundingBox(),
    step.boundingBox(),
  ]);
  if (!lineBox || !paneBox || !stepBox) return null;
  return {
    inView: lineBox.y >= paneBox.y,
    aboveStep: lineBox.y + lineBox.height <= stepBox.y,
  };
}

/** The person scrolls the log up to the start of the conversation, the way a
 *  reader looks back at the history. Fails when there is no history to scroll,
 *  so a caller never passes by scrolling nothing. */
export async function scrollLogToStart(page: Page): Promise<void> {
  const pane = managerOnboarding(page).locator(".conversation-scroll-pane");
  await expect
    .poll(() => pane.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(0);
  await pane.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(0);
}

/**
 * The newest line of the conversation sits whole in the log, above the step;
 * the manager's latest line and the latest answer are never under the step,
 * though on a phone the older of the two may have scrolled off the top.
 */
export async function expectLatestLinesClearOfStep(page: Page): Promise<void> {
  const log = managerOnboarding(page);
  const step = onboardingPrompt(page);
  await expect(step).toBeVisible();
  const pane = log.locator(".conversation-scroll-pane");
  const newest = log.locator("[data-conversation-message-key]").last();
  await expect
    .poll(() => clearance(newest, pane, step))
    .toEqual({ inView: true, aboveStep: true });
  for (const line of [
    log.locator('[data-conversation-message-key^="assistant-"]').last(),
    log.locator('[data-conversation-message-key^="user-"]').last(),
  ]) {
    if ((await line.count()) === 0) continue;
    await expect
      .poll(async () => (await clearance(line, pane, step))?.aboveStep)
      .toBe(true);
  }
}
