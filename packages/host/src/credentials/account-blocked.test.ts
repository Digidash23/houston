import { expect, test } from "vitest";
import { accountBlockedDetail } from "./account-blocked";

// GitHub's Copilot mint 403 for a locked billing account, verbatim from prod
// (H-005), and the two ways it reaches this host: as a response body (the
// gateway's own exchange) and inside pi-ai's thrown "<status> <text>: <body>".
const body =
  '{"error_details":{"message":"Your account\'s billing is currently locked because recent account charges have failed. Please update your payment method to restore access.","url":"https://github.com/settings/billing","notification_id":"billing_locked"}}';

test("reads GitHub's sentence out of the nested body", () => {
  expect(accountBlockedDetail(body)).toBe(
    "Your account's billing is currently locked because recent account charges have failed. Please update your payment method to restore access.",
  );
});

test("reads it through pi-ai's thrown message prefix", () => {
  expect(accountBlockedDetail(`403 Forbidden: ${body}`)).toMatch(
    /^Your account's billing is currently locked/,
  );
});

test("reads the flat message shape too", () => {
  expect(
    accountBlockedDetail('{"message":"Billing is locked for this account"}'),
  ).toBe("Billing is locked for this account");
});

test("a 403 that names no billing lock is not a block", () => {
  expect(
    accountBlockedDetail(
      '403 Forbidden: {"error_details":{"message":"You do not have access to GitHub Copilot."}}',
    ),
  ).toBeNull();
  expect(accountBlockedDetail("502 Bad Gateway: <html>boom</html>")).toBeNull();
  expect(accountBlockedDetail("")).toBeNull();
});

test("the detail is bounded", () => {
  const long = `{"message":"billing locked ${"x".repeat(500)}"}`;
  expect(accountBlockedDetail(long)?.length).toBe(200);
});
