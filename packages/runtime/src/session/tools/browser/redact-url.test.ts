import { expect, test } from "vitest";
import { redactUrl } from "./redact-url";

test("a GET-submitted password never shows in the address", () => {
  expect(
    redactUrl("https://site.test/login?username=student&password=Hunter2"),
  ).toBe("https://site.test/login?username=student&password=[hidden]");
});

test.each([
  ["pwd", "https://a.test/?pwd=x", "https://a.test/?pwd=[hidden]"],
  ["otp", "https://a.test/?OTP=123456", "https://a.test/?OTP=[hidden]"],
  [
    "oauth code and state",
    "https://a.test/cb?code=abc&state=s1",
    "https://a.test/cb?code=[hidden]&state=s1",
  ],
  [
    "fragment token",
    "https://a.test/cb#access_token=t&expires_in=3600",
    "https://a.test/cb#access_token=[hidden]&expires_in=3600",
  ],
  ["api key", "https://a.test/?api_key=k", "https://a.test/?api_key=[hidden]"],
  [
    "secret",
    "https://a.test/?client_secret=k",
    "https://a.test/?client_secret=[hidden]",
  ],
  ["userinfo", "https://me:pw@a.test/", "https://me:hidden@a.test/"],
])("hides %s", (_name, raw, shown) => {
  expect(redactUrl(raw)).toBe(shown);
});

test("an ordinary address, a plain fragment and non-URLs are unchanged", () => {
  for (const raw of [
    "https://a.test/search?q=shoes&page=2",
    "https://a.test/docs#install",
    "about:blank",
    "not a url",
  ])
    expect(redactUrl(raw)).toBe(raw);
});
