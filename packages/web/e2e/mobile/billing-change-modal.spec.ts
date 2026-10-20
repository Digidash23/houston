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
 * announcement: the actions sit at the bottom, and the picker opens in the
 * same sheet without a horizontal scroll.
 */

test("the modal fills the phone, and the picker opens in the same sheet", async ({
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
  await expect(
    modal.getByRole("button", { name: "Keep La Fila free" }),
  ).toBeVisible();
  const picking = await modal.boundingBox();
  expect(picking && Math.round(picking.y + picking.height)).toBe(
    viewport?.height,
  );
});
