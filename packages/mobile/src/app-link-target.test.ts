import { expect, test } from "vitest";
import { appLinkTarget } from "./app-link-target";

test("opens only the app's public links", () => {
  expect(appLinkTarget("https://app.gethouston.ai/")).toEqual({ kind: "home" });
  for (const url of [
    "https://app.gethouston.ai/settings/plan?return=1",
    "https://app.gethouston.ai/settings/channels",
    "https://evil.test/",
    "http://app.gethouston.ai/",
    "https://app.gethouston.ai:444/",
    "https://app.gethouston.ai.evil.test/",
  ]) {
    expect(appLinkTarget(url)).toBeNull();
  }
});

test("takes a LinkedIn connect's return with its ticket", () => {
  expect(
    appLinkTarget("houston://settings/linkedin?linkedin=tkt_0123456789"),
  ).toEqual({
    kind: "linkedin",
    completion: { kind: "ticket", ticket: "tkt_0123456789" },
  });
  // A mangled ticket still lands, so the app can say it will not connect.
  expect(appLinkTarget("houston://settings/linkedin?linkedin=x")).toEqual({
    kind: "linkedin",
    completion: { kind: "invalid" },
  });
});

test("takes no other houston:// link", () => {
  for (const url of [
    "houston://settings/linkedin",
    "houston://settings/channels?slack=tkt_0123456789",
    "houston://settings/plan",
    "houston://auth-callback?code=1",
  ]) {
    expect(appLinkTarget(url)).toBeNull();
  }
});
