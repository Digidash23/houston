import {
  armCapabilities,
  armChoice,
  CHOOSE,
  choiceCalls,
  choiceModal,
  INNOVA,
  installChoiceClock,
  LA_FILA,
  MODAL_TITLE,
  memberChoice,
  ownerChoice,
  payerChoice,
  SPACES_OWNER_CAPS,
  settingsPicker,
  singleOrgChoice,
} from "./support/billing-choice";
import { expect, test } from "./support/fixtures";
import {
  announcementDialog,
  armPlan,
  billingScreen,
  freePlan,
  openBilling,
} from "./support/plan";

/**
 * The announcement that plans move to organizations: a modal on app open,
 * cloud only. An owner who still has to pick sees it on every open until they
 * do, and picks in the same frame; everyone else reads it once. It never
 * stacks on a plan dialog.
 */

test.beforeEach(async ({ page }) => {
  await installChoiceClock(page);
});

const routes = async () => (await choiceCalls()).map((call) => call.route);

test("an owner picks the org that stays free from the modal, and it stays gone", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(ownerChoice());
  await page.goto("/");

  const modal = choiceModal(page);
  await expect(page.getByRole("dialog", { name: MODAL_TITLE })).toBeVisible({
    timeout: 15_000,
  });
  await expect(modal).toContainText(
    "From Friday, October 23, one of your organizations stays free. The others are $15 per member a month.",
  );
  await expect(modal).not.toContainText(/\d+ messages a week/);
  await modal.getByRole("button", { name: CHOOSE }).click();

  await expect(
    page.getByRole("dialog", { name: "Which organization stays free?" }),
  ).toBeVisible();
  await expect(
    modal.getByRole("radiogroup", { name: "Which organization stays free?" }),
  ).toBeVisible();
  await expect(modal.getByRole("radio")).toHaveCount(3);
  await expect(modal.locator("label").first()).toContainText(
    "La FilaMost active1 member · 396 messages in the last 30 days",
  );
  await expect(modal.getByRole("radio", { name: /La Fila/ })).toBeChecked();
  await expect(modal).toContainText("You can change this until October 23.");

  await modal.getByText("Innova", { exact: true }).click();
  await modal.getByRole("button", { name: "Keep Innova free" }).click();
  await expect(modal).toBeHidden();
  expect((await choiceCalls()).filter((c) => c.route === "set")).toEqual([
    { route: "set", body: { freeOrgSlug: INNOVA.slug } },
  ]);

  await page.reload();
  await expect(page.getByRole("main")).toBeVisible();
  await expect
    .poll(async () => (await routes()).filter((r) => r === "get").length)
    .toBe(2);
  await expect(choiceModal(page)).toBeHidden();
});

test("a Plus payer reads that the subscription moves, then picks both orgs", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(payerChoice());
  await page.goto("/");

  const modal = choiceModal(page);
  await expect(modal).toContainText(
    "Your subscription moves to the organization you pick.",
    { timeout: 15_000 },
  );
  await modal.getByRole("button", { name: CHOOSE }).click();
  await expect(modal).toContainText("Step 1 of 2");
  await modal.getByRole("button", { name: "Keep La Fila free" }).click();

  await expect(modal).toContainText("Step 2 of 2");
  await expect(modal.getByRole("radio")).toHaveCount(2);
  await expect(modal.getByRole("radio", { name: /Innova/ })).toBeChecked();
  await expect(modal).toContainText("$60per month");
  await expect(modal).toContainText(
    "Your price stays $15 a month until November 22, then it's $60 a month.",
  );
  await expect(modal).toContainText("La FilaStays free");
  await modal.getByRole("button", { name: "Use my plan for Innova" }).click();

  await expect(modal).toBeHidden();
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
  const modal = choiceModal(page);
  await modal.getByRole("button", { name: CHOOSE }).click({ timeout: 15_000 });
  await modal.getByRole("button", { name: "Keep La Fila free" }).click();
  await expect(page.getByText("You don't own that organization")).toBeVisible();
  await expect(modal.getByRole("radio")).toHaveCount(3);
});

test("Maybe later hides it for this session only, and Billing still opens the picker", async ({
  page,
}) => {
  await armCapabilities({ ...SPACES_OWNER_CAPS, plan: true });
  await armPlan({ summary: freePlan() });
  await armChoice(ownerChoice());
  await page.goto("/");

  const modal = choiceModal(page);
  // The text button; the X carries the same name.
  await modal.getByRole("button", { name: "Maybe later" }).first().click({
    timeout: 15_000,
  });
  await expect(modal).toBeHidden();

  await openBilling(page);
  await expect(
    billingScreen(page).getByRole("heading", {
      name: "Choose your free organization",
    }),
  ).toBeVisible();
  await billingScreen(page).getByRole("button", { name: "Choose" }).click();
  const picker = settingsPicker(page);
  await expect(picker.getByRole("radio")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(
    billingScreen(page).getByRole("button", { name: "Choose" }),
  ).toBeFocused();
  expect(await routes()).not.toContain("dismiss");

  await page.reload();
  await expect(page.getByRole("dialog", { name: MODAL_TITLE })).toBeVisible({
    timeout: 15_000,
  });
  expect(await routes()).not.toContain("dismiss");
});

test("closing with the X is also Maybe later for an owner who has to pick", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(ownerChoice());
  await page.goto("/");
  const modal = choiceModal(page);
  await modal.getByRole("button", { name: CHOOSE }).click({ timeout: 15_000 });
  await modal.getByRole("button", { name: "Maybe later" }).click();
  await expect(modal).toBeHidden();
  expect(await routes()).not.toContain("dismiss");
});

test("a member reads it once: Got it dismisses it on every device", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(memberChoice());
  await page.goto("/");
  const modal = choiceModal(page);
  await expect(modal).toContainText(
    "From Friday, October 23, plans work per organization. Your organization's owner chooses the plan.",
    { timeout: 15_000 },
  );
  await expect(modal.getByRole("button", { name: "Maybe later" })).toHaveCount(
    0,
  );
  await modal.getByRole("button", { name: "Got it" }).click();
  await expect(modal).toBeHidden();
  await expect.poll(routes).toContain("dismiss");

  await page.reload();
  await expect(page.getByRole("main")).toBeVisible();
  await expect
    .poll(async () => (await routes()).filter((r) => r === "get").length)
    .toBe(2);
  await expect(choiceModal(page)).toBeHidden();
});

test("a single-org owner reads that it stays free; the X dismisses it too", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(singleOrgChoice());
  await page.goto("/");
  const modal = choiceModal(page);
  await expect(modal).toContainText(
    "From Friday, October 23, La Fila stays free. Upgrade anytime for $15 per member a month.",
    { timeout: 15_000 },
  );
  await modal.getByRole("button", { name: "Close" }).click();
  await expect(modal).toBeHidden();
  await expect.poll(routes).toContain("dismiss");
});

test("it waits behind the launch announcement, then follows it", async ({
  page,
}) => {
  await armCapabilities({ ...SPACES_OWNER_CAPS, plan: true });
  await armPlan({ summary: freePlan({ announcement: true }) });
  await armChoice(ownerChoice());
  await page.goto("/");

  const launch = announcementDialog(page);
  await expect(launch).toBeVisible({ timeout: 15_000 });
  await expect.poll(routes).toContain("get");
  await page.clock.runFor(3_000);
  await expect(choiceModal(page)).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(1);

  await launch.getByRole("button", { name: "Maybe later" }).last().click();
  await expect(launch).toBeHidden();
  await expect(page.getByRole("dialog", { name: MODAL_TITLE })).toBeVisible();
});

test("off a spaces host there is no modal and no read", async ({ page }) => {
  await armChoice(ownerChoice());
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await page.clock.runFor(3_000);
  await expect(choiceModal(page)).toBeHidden();
  expect(await choiceCalls()).toEqual([]);
});

test("a gateway without the route shows nothing", async ({ page }) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await page.clock.runFor(3_000);
  await expect(choiceModal(page)).toBeHidden();
});
