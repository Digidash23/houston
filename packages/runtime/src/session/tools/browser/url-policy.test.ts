import { describe, expect, test } from "vitest";
import { BrowserToolError } from "./errors";
import { checkBrowserUrl, landedSafely, loopbackOrigins } from "./url-policy";

const own = loopbackOrigins(4317);

function code(raw: string): string {
  try {
    checkBrowserUrl(raw, own);
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserToolError);
    return (error as BrowserToolError).code;
  }
  return "allowed";
}

describe("checkBrowserUrl", () => {
  test("web pages pass, and a bare host gets https", () => {
    expect(checkBrowserUrl("https://example.com/a?b=1", own).href).toBe(
      "https://example.com/a?b=1",
    );
    expect(checkBrowserUrl("http://example.com", own).protocol).toBe("http:");
    expect(checkBrowserUrl("example.com/login", own).href).toBe(
      "https://example.com/login",
    );
  });

  test("anything but http and https is refused", () => {
    for (const raw of [
      "file:///etc/passwd",
      "chrome://settings",
      "javascript:alert(1)",
      "data:text/html,hi",
      "about:blank",
      "ftp://example.com",
    ])
      expect(code(raw)).toBe("url_refused");
  });

  test("this runtime's own listener is refused on every loopback name", () => {
    expect(code("http://127.0.0.1:4317/conversations")).toBe("url_refused");
    expect(code("http://localhost:4317")).toBe("url_refused");
    expect(code("http://[::1]:4317/")).toBe("url_refused");
    // Another local port is the person's own business (a dev server).
    expect(code("http://127.0.0.1:3000")).toBe("allowed");
  });

  test("an empty or unparseable address is an invalid action", () => {
    expect(code("")).toBe("invalid_action");
    expect(code("https://exa mple.com")).toBe("invalid_action");
  });
});

describe("landedSafely", () => {
  test("a redirect onto a refused page is caught", () => {
    expect(landedSafely("https://example.com/home", own)).toBe(true);
    expect(landedSafely("about:blank", own)).toBe(true);
    expect(landedSafely("http://localhost:4317/v1", own)).toBe(false);
    expect(landedSafely("file:///etc/hosts", own)).toBe(false);
    expect(landedSafely("chrome-error://chromewebdata/", own)).toBe(false);
  });
});
