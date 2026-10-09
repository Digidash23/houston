import { describe, expect, test } from "vitest";
import { BrowserToolError } from "./errors";
import { checkBrowserUrl, isBlockedHost, landedSafely } from "./url-policy";

function code(raw: string): string {
  try {
    checkBrowserUrl(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserToolError);
    return (error as BrowserToolError).code;
  }
  return "allowed";
}

describe("checkBrowserUrl", () => {
  test("web pages pass, and a bare host gets https", () => {
    expect(checkBrowserUrl("https://example.com/a?b=1").href).toBe(
      "https://example.com/a?b=1",
    );
    expect(checkBrowserUrl("http://example.com").protocol).toBe("http:");
    expect(checkBrowserUrl("example.com/login").href).toBe(
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

  test("this machine is refused on every port and spelling", () => {
    for (const raw of [
      "http://127.0.0.1:4317/conversations",
      "http://127.0.0.1:4318/v1/agents",
      "http://127.0.0.1:3000",
      "http://127.8.9.10/",
      "http://localhost:11434/api/pull",
      "http://app.localhost/",
      "http://[::1]:4317/",
      "http://[::ffff:127.0.0.1]/",
      "http://2130706433/",
      "http://0.0.0.0:4318/",
      "http://[::]/",
    ])
      expect(code(raw), raw).toBe("url_refused");
  });

  test("cloud metadata and cluster-internal names are refused", () => {
    for (const raw of [
      "http://169.254.169.254/computeMetadata/v1/",
      "http://metadata.google.internal/",
      "http://metadata/",
      "http://[fe80::1]/",
      "http://[::ffff:169.254.169.254]/",
    ])
      expect(code(raw), raw).toBe("url_refused");
  });

  test("ordinary hosts that merely look local pass", () => {
    expect(isBlockedHost("localhost.example.com")).toBe(false);
    expect(isBlockedHost("127.example.com")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
  });

  test("an empty or unparseable address is an invalid action", () => {
    expect(code("")).toBe("invalid_action");
    expect(code("https://exa mple.com")).toBe("invalid_action");
  });
});

describe("landedSafely", () => {
  test("a redirect onto a refused page is caught", () => {
    expect(landedSafely("https://example.com/home")).toBe(true);
    expect(landedSafely("about:blank")).toBe(true);
    expect(landedSafely("http://localhost:4317/v1")).toBe(false);
    expect(landedSafely("http://169.254.169.254/")).toBe(false);
    expect(landedSafely("file:///etc/hosts")).toBe(false);
    expect(landedSafely("chrome-error://chromewebdata/")).toBe(false);
  });
});
