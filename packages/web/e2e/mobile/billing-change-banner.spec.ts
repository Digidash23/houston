import {
  armCapabilities,
  armChoice,
  banner,
  installChoiceClock,
  ownerChoice,
  picker,
  SPACES_OWNER_CAPS,
} from "../support/billing-choice";
import { expect, test } from "../support/fixtures";

/**
 * On a phone the announcement wraps: the text, then the action on its own
 * row, with the X kept top right. The picker rises as a bottom sheet.
 */

test("the action wraps onto its own row and the picker is a bottom sheet", async ({
  page,
}) => {
  await installChoiceClock(page);
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(ownerChoice());
  await page.goto("/");

  const bar = banner(page);
  const choose = bar.getByRole("button", {
    name: "Choose your free organization",
  });
  await expect(choose).toBeVisible();
  const text = await bar.locator("p").boundingBox();
  const button = await choose.boundingBox();
  expect(button && text && button.y >= text.y + text.height).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  await choose.tap();
  const sheet = picker(page);
  await expect(sheet).toHaveAttribute("data-slot", "sheet-content");
  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && Math.round(box.y + box.height)).toBe(
    viewport?.height,
  );
  await expect(
    sheet.getByRole("button", { name: "Keep La Fila free" }),
  ).toBeVisible();
});
