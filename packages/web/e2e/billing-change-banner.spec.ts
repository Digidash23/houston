import {
  armCapabilities,
  armChoice,
  banner,
  choiceCalls,
  INNOVA,
  installChoiceClock,
  LA_FILA,
  ownerChoice,
  payerChoice,
  picker,
  SPACES_OWNER_CAPS,
} from "./support/billing-choice";
import { expect, test } from "./support/fixtures";
import { armPlan, billingScreen, freePlan, openBilling } from "./support/plan";

/**
 * The announcement that plans move to organizations, and the picker an owner
 * uses to keep one free. Cloud only: the bar reads the account's choice from
 * the gateway once the board has painted, and never on a non-spaces host.
 */

test.beforeEach(async ({ page }) => {
  await installChoiceClock(page);
});

test("an owner picks the org that stays free, and the bar reads it back", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(ownerChoice());
  await page.goto("/");

  const bar = banner(page);
  await expect(bar).toContainText(
    "Starting Friday, October 23, plans move to organizations.",
  );
  await bar
    .getByRole("button", { name: "Choose your free organization" })
    .click();

  const dialog = picker(page);
  await expect(
    page.getByRole("dialog", { name: "Which organization stays free?" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("radiogroup", { name: "Which organization stays free?" }),
  ).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await expect(dialog.locator("label").first()).toContainText(
    "La FilaMost active1 member · 396 messages in the last 30 days",
  );
  await expect(dialog.getByRole("radio", { name: /La Fila/ })).toBeChecked();
  await expect(dialog).toContainText("You can change this until October 23.");

  await dialog.getByText("Innova", { exact: true }).click();
  await dialog.getByRole("button", { name: "Keep Innova free" }).click();
  await expect(dialog).toBeHidden();
  await expect(bar).toContainText(
    "Innova stays free. Your other organizations need a plan from October 23.",
  );
  expect((await choiceCalls()).filter((c) => c.route === "set")).toEqual([
    { route: "set", body: { freeOrgSlug: INNOVA.slug } },
  ]);

  await page.reload();
  await expect(banner(page)).toContainText("Innova stays free.");
  expect((await choiceCalls()).filter((c) => c.route === "get")).toHaveLength(
    2,
  );
});

test("a Plus payer also picks the org the subscription pays for", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(payerChoice());
  await page.goto("/");

  await expect(banner(page)).toContainText(
    "Your subscription moves to the organization you choose.",
  );
  await banner(page)
    .getByRole("button", { name: "Choose your free organization" })
    .click();
  const dialog = picker(page);
  await expect(dialog).toContainText("Step 1 of 2");
  await dialog.getByRole("button", { name: "Keep La Fila free" }).click();

  await expect(dialog).toContainText("Step 2 of 2");
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  await expect(dialog.getByRole("radio", { name: /Innova/ })).toBeChecked();
  await expect(dialog).toContainText("$60per month");
  await expect(dialog).toContainText(
    "Your price stays $15 a month until November 22, then it's $60 a month.",
  );
  await expect(dialog).toContainText("La FilaStays free");
  await dialog.getByRole("button", { name: "Use my plan for Innova" }).click();

  await expect(dialog).toBeHidden();
  await expect(banner(page)).toContainText(
    "La Fila stays free. Your subscription pays for Innova, and your other organizations need a plan from October 23.",
  );
  expect((await choiceCalls()).filter((c) => c.route === "set")).toEqual([
    {
      route: "set",
      body: { freeOrgSlug: LA_FILA.slug, paidOrgSlug: INNOVA.slug },
    },
  ]);
});

test("a refused pick shows its own copy and keeps the picker open", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(ownerChoice(), "not_owner");
  await page.goto("/");
  await banner(page)
    .getByRole("button", { name: "Choose your free organization" })
    .click();
  await picker(page).getByRole("button", { name: "Keep La Fila free" }).click();
  await expect(page.getByText("You don't own that organization")).toBeVisible();
  await expect(picker(page)).toBeVisible();
});

test("closing the picker puts focus back on the bar", async ({ page }) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(ownerChoice());
  await page.goto("/");
  const choose = banner(page).getByRole("button", {
    name: "Choose your free organization",
  });
  await choose.click();
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toBeHidden();
  await expect(choose).toBeFocused();
});

test("dismissing hides the bar for good, and Billing still opens the picker", async ({
  page,
}) => {
  await armCapabilities({ ...SPACES_OWNER_CAPS, plan: true });
  await armPlan({ summary: freePlan() });
  await armChoice(ownerChoice());
  await page.goto("/");

  await banner(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(banner(page)).toBeHidden();
  await expect
    .poll(async () => (await choiceCalls()).map((c) => c.route))
    .toContain("dismiss");
  await page.reload();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(banner(page)).toBeHidden();

  await openBilling(page);
  const row = billingScreen(page).getByRole("heading", {
    name: "Choose your free organization",
  });
  await expect(row).toBeVisible();
  await billingScreen(page).getByRole("button", { name: "Choose" }).click();
  await expect(picker(page)).toBeVisible();
});

test("a member reads that the owner chooses, with nothing to pick", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(ownerChoice({ needed: false, orgs: [] }));
  await page.goto("/");
  await expect(banner(page)).toContainText(
    "Your organization's owner will choose.",
  );
  await expect(banner(page).getByRole("button")).toHaveCount(1);
});

test("off a spaces host there is no bar and no read", async ({ page }) => {
  await armChoice(ownerChoice());
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await page.clock.runFor(3_000);
  await expect(banner(page)).toBeHidden();
  expect(await choiceCalls()).toEqual([]);
});

test("a gateway without the route shows nothing", async ({ page }) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await page.clock.runFor(3_000);
  await expect(banner(page)).toBeHidden();
});
