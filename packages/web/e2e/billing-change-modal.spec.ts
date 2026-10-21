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
    "Thanks for helping us shape how teams work in Houston. From Friday, October 23, personal and team spaces work the same, so you can invite people to any of them. Each account keeps one free organization. If you made a few just to try things, pick the one to keep.",
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

  await modal.getByText("Innova", { exact: true }).click();
  await modal.getByRole("button", { name: "Keep Innova free" }).click();

  // The same frame confirms the pick, and survives the refetch behind it.
  await expect(
    page.getByRole("dialog", { name: "Innova stays free" }),
  ).toBeVisible();
  await expect(modal).toContainText(
    "Your other organizations need a plan from Friday, October 23.",
  );
  await expect(modal).toContainText("You can change this in Settings.");
  await expect(modal.getByRole("radio")).toHaveCount(0);
  expect((await choiceCalls()).filter((c) => c.route === "set")).toEqual([
    { route: "set", body: { freeOrgSlug: INNOVA.slug } },
  ]);
  await page.clock.runFor(3_000);
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Done" }).click();
  await expect(modal).toBeHidden();
  await page.clock.runFor(3_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);

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
    "Your subscription moves to the organization you choose.",
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

  await expect(
    page.getByRole("dialog", { name: "La Fila stays free" }),
  ).toBeVisible();
  await expect(modal).toContainText(
    "Your subscription pays for Innova from Friday, October 23.",
  );
  // A third org is neither free nor paid for.
  await expect(modal).toContainText(
    "Your other organizations need a plan from Friday, October 23.",
  );
  expect((await choiceCalls()).filter((c) => c.route === "set")).toEqual([
    {
      route: "set",
      body: { freeOrgSlug: LA_FILA.slug, paidOrgSlug: INNOVA.slug },
    },
  ]);
  await modal.getByRole("button", { name: "Done" }).click();
  await expect(modal).toBeHidden();

  await page.reload();
  await expect(page.getByRole("main")).toBeVisible();
  await expect
    .poll(async () => (await routes()).filter((r) => r === "get").length)
    .toBe(2);
  await expect(choiceModal(page)).toBeHidden();
});

test("Escape closes the success step like Done", async ({ page }) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(ownerChoice());
  await page.goto("/");
  const modal = choiceModal(page);
  await modal.getByRole("button", { name: CHOOSE }).click({ timeout: 15_000 });
  await modal.getByRole("button", { name: "Keep La Fila free" }).click();
  await expect(
    page.getByRole("dialog", { name: "La Fila stays free" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  expect(await routes()).not.toContain("dismiss");
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
  await expect(modal.getByRole("button", { name: "Done" })).toHaveCount(0);
  await expect(modal).not.toContainText("You can change this in Settings.");
});

test("a refusal that leaves one owned org swaps the picker for the notice", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  // The other orgs were handed over meanwhile: the refetch owns one org.
  await armChoice(ownerChoice(), "not_owner", {
    afterRefusal: singleOrgChoice(),
  });
  await page.goto("/");
  const modal = choiceModal(page);
  await modal.getByRole("button", { name: CHOOSE }).click({ timeout: 15_000 });
  await modal.getByRole("button", { name: "Keep La Fila free" }).click();
  await expect(page.getByText("You don't own that organization")).toBeVisible();

  await expect(modal).toContainText(
    "Thanks for helping us shape how teams work in Houston. From Friday, October 23, personal and team spaces work the same, so you can invite people to La Fila. It stays free.",
  );
  await expect(modal.getByRole("radio")).toHaveCount(0);
  await expect(modal.getByRole("button", { name: "Got it" })).toBeVisible();
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

test("a pick from Billing ends on the success step, and the modal stays gone", async ({
  page,
}) => {
  await armCapabilities({ ...SPACES_OWNER_CAPS, plan: true });
  await armPlan({ summary: freePlan() });
  await armChoice(ownerChoice());
  await page.goto("/");
  await choiceModal(page)
    .getByRole("button", { name: "Maybe later" })
    .first()
    .click({ timeout: 15_000 });

  await openBilling(page);
  await billingScreen(page).getByRole("button", { name: "Choose" }).click();
  const picker = settingsPicker(page);
  await picker.getByText("Innova", { exact: true }).click();
  await picker.getByRole("button", { name: "Keep Innova free" }).click();
  await expect(
    page.getByRole("dialog", { name: "Innova stays free" }),
  ).toBeVisible();
  await expect(picker).toContainText(
    "Your other organizations need a plan from Friday, October 23.",
  );
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(picker).toBeHidden();
  await expect(billingScreen(page)).toContainText(
    "Innova stays free from October 23.",
  );
  await expect(
    billingScreen(page).getByRole("button", { name: "Change" }),
  ).toBeFocused();

  // Reopening starts on the picker again, on the stored pick.
  await billingScreen(page).getByRole("button", { name: "Change" }).click();
  await expect(picker.getByRole("radio", { name: /Innova/ })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  await page.reload();
  await expect(page.getByRole("main")).toBeVisible();
  await expect
    .poll(async () => (await routes()).filter((r) => r === "get").length)
    .toBe(2);
  await expect(choiceModal(page)).toBeHidden();
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
    "Thanks for helping us shape how teams work in Houston. From Friday, October 23, personal and team spaces work the same.",
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

test("a failed Got it keeps the modal closed, and a later open retries", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(memberChoice(), undefined, { failDismiss: true });
  await page.goto("/");
  const modal = choiceModal(page);
  await modal
    .getByRole("button", { name: "Got it" })
    .click({ timeout: 15_000 });
  await expect(modal).toBeHidden();
  await expect.poll(routes).toContain("dismiss");
  await page.clock.runFor(3_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Nothing was stored, so the next open shows it again.
  await page.reload();
  await expect(page.getByRole("dialog", { name: MODAL_TITLE })).toBeVisible({
    timeout: 15_000,
  });
});

test("a single-org owner reads that it stays free; the X dismisses it too", async ({
  page,
}) => {
  await armCapabilities(SPACES_OWNER_CAPS);
  await armChoice(singleOrgChoice());
  await page.goto("/");
  const modal = choiceModal(page);
  await expect(modal).toContainText(
    "Thanks for helping us shape how teams work in Houston. From Friday, October 23, personal and team spaces work the same, so you can invite people to La Fila. It stays free.",
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
