import { expect, test, vi } from "vitest";
import { openExternalUrl } from "./open-url";

const base = "capacitor://localhost/";

test("web links open in the in-app browser, resolved against the app", async () => {
  const ports = {
    browser: vi.fn().mockResolvedValue(undefined),
    system: vi.fn(),
  };
  await expect(
    openExternalUrl("/pricing", "https://app.test/x", ports),
  ).resolves.toBe(true);
  expect(ports.browser).toHaveBeenCalledWith("https://app.test/pricing");
  expect(ports.system).not.toHaveBeenCalled();
});

test("mail, phone and sms links go to the system handler, never the browser", async () => {
  for (const url of [
    "mailto:help@example.test",
    "tel:+15551234",
    "sms:+15551234",
  ]) {
    const ports = { browser: vi.fn(), system: vi.fn() };
    await expect(openExternalUrl(url, base, ports)).resolves.toBe(true);
    expect(ports.system).toHaveBeenCalledWith(url);
    expect(ports.browser).not.toHaveBeenCalled();
  }
});

test("other schemes are refused", async () => {
  const ports = { browser: vi.fn(), system: vi.fn() };
  await expect(
    openExternalUrl("javascript:alert(1)", base, ports),
  ).rejects.toThrow("unsupported URL scheme javascript:");
  expect(ports.system).not.toHaveBeenCalled();
});
