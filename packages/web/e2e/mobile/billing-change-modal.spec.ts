import {
  armCapabilities,
  armChoice,
  CHOOSE,
  choiceModal,
  installChoiceClock,
  ownerChoice,
  SPACES_OWNER_CAPS,
} from "../support/billing-choice";
import { expect, test } from "../support/fixtures";

/**
 * On a phone the pricing-change modal is a full-height sheet, like the launch
 * announcement: the actions sit at the bottom, and the picker and its
 * success step open in the same sheet without a horizontal scroll.
 */

test("the modal fills the phone, and the picker and its success step open in the same sheet", async ({
  page,
}) => {
  await installChoiceClock(page);
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(ownerChoice());
  await page.goto("/");

  const modal = choiceModal(page);
  const choose = modal.getByRole("button", { name: CHOOSE });
  await expect(choose).toBeVisible({ timeout: 15_000 });
  const viewport = page.viewportSize();
  const box = await modal.boundingBox();
  expect(box && viewport && Math.round(box.y)).toBe(0);
  expect(box && viewport && Math.round(box.y + box.height)).toBe(
    viewport?.height,
  );
  const button = await choose.boundingBox();
  expect(button && viewport && button.y > viewport.height / 2).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  await choose.tap();
  const keep = modal.getByRole("button", { name: "Keep La Fila free" });
  await expect(keep).toBeVisible();
  const picking = await modal.boundingBox();
  expect(picking && Math.round(picking.y + picking.height)).toBe(
    viewport?.height,
  );
  const keepBox = await keep.boundingBox();
  expect(keepBox && viewport && keepBox.y > viewport.height / 2).toBe(true);

  await keep.tap();
  const done = modal.getByRole("button", { name: "Done" });
  await expect(done).toBeVisible();
  await expect(modal).toContainText("La Fila stays free");
  const doneBox = await done.boundingBox();
  expect(doneBox && viewport && doneBox.y > viewport.height / 2).toBe(true);
  await done.tap();
  await expect(modal).toBeHidden();

  await page.reload();
  await expect(page.getByRole("main")).toBeVisible();
  await page.clock.runFor(3_000);
  await expect(choiceModal(page)).toBeHidden();
});
