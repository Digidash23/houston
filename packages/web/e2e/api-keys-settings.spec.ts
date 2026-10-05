import { FAKE_HOST_URL, SEED_AGENT_NAME } from "@houston/fake-host";
import type { Page } from "@playwright/test";
import { openAgentSettings } from "./support/agent-nav";
import { expect, test } from "./support/fixtures";
import { openSettings } from "./support/settings-nav";

const PERSONAL_SLUG = "fedcba9876543210";
const SECRET = `hst_${"9f2c1a7b4e8d0364".repeat(4)}`;

/**
 * The fake host serves neither `/v1/keys` nor a personal org slug, so both are
 * answered here: one existing key, a mint that returns the secret once, and
 * the personal membership the Organization ID row reads its slug from.
 */
async function mockGateway(page: Page) {
  const keys = [
    {
      id: "key-1",
      name: "Zapier",
      prefix: "hst_9f2c",
      createdAt: "2026-09-08T12:00:00Z",
    },
  ];
  await page.route("**/v1/keys**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const { name } = request.postDataJSON() as { name: string };
      const created = {
        id: "key-2",
        name,
        prefix: "hst_aaaa",
        createdAt: "2026-10-05T12:00:00Z",
      };
      keys.unshift(created);
      return route.fulfill({ status: 201, json: { ...created, key: SECRET } });
    }
    return route.fulfill({ json: { keys } });
  });
  await page.route("**/v1/orgs", (route) =>
    route.fulfill({
      json: {
        orgs: [
          {
            id: "org-personal",
            slug: PERSONAL_SLUG,
            name: "Personal",
            kind: "personal",
            role: "owner",
            memberCount: 1,
            degraded: false,
          },
        ],
        invites: [],
      },
    }),
  );
}

test("Settings lists API keys only where the public API is served", async ({
  page,
}) => {
  // The row is also absent while capabilities load, so the absence below
  // only proves the gate once the answer has arrived.
  const capabilities = page.waitForResponse("**/v1/capabilities");
  await page.goto("/");
  await capabilities;
  await openSettings(page);
  await expect(page.getByRole("button", { name: /^API keys/ })).toHaveCount(0);
});

test("API keys shows the organization ID, mints a key once, and links the docs", async ({
  page,
  request,
}) => {
  await request.post(`${FAKE_HOST_URL}/__test__/capabilities`, {
    data: { apiKeys: true },
  });
  await mockGateway(page);
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("button", { name: /^API keys/ }).click();
  await expect(
    page.getByRole("heading", { name: "API keys", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(PERSONAL_SLUG)).toBeVisible();
  await expect(page.getByText("Zapier", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create key" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("My script");
  await dialog.getByRole("button", { name: "Create key" }).click();
  await expect(dialog.getByText(SECRET)).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("My script", { exact: true })).toBeVisible();

  const docs = page.getByRole("button", { name: "Read the developer docs" });
  await expect(docs).toBeVisible();
  const popup = page.waitForEvent("popup");
  await docs.click();
  expect((await popup).url()).toContain("gethouston.ai/developers");

  // Phone width: the ID and its copy control stay on screen side by side.
  await page.setViewportSize({ width: 412, height: 915 });
  await expect(page.getByText(PERSONAL_SLUG)).toBeInViewport();
  await expect(page.getByRole("button", { name: "Copy" })).toBeInViewport();
});

test("an AI Employee's Settings shows its API access and opens the keys", async ({
  page,
  request,
}) => {
  await request.post(`${FAKE_HOST_URL}/__test__/capabilities`, {
    data: { apiKeys: true },
  });
  await mockGateway(page);
  await page.goto("/");
  await openAgentSettings(page, SEED_AGENT_NAME, null);
  await expect(
    page.getByRole("heading", { name: "API access", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Agent ID", { exact: true })).toBeVisible();
  await expect(page.getByText(PERSONAL_SLUG)).toBeVisible();
  await page.getByRole("button", { name: /^API keys/ }).click();
  await expect(
    page.getByRole("heading", { name: "API keys", exact: true }),
  ).toBeVisible();
});

test("an AI Employee's Settings has no API access without the public API", async ({
  page,
}) => {
  const capabilities = page.waitForResponse("**/v1/capabilities");
  await page.goto("/");
  await capabilities;
  await openAgentSettings(page, SEED_AGENT_NAME, null);
  await expect(page.getByText("Change color & name")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "API access", exact: true }),
  ).toHaveCount(0);
});
