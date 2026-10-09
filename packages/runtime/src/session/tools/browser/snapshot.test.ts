import { expect, test } from "vitest";
import { capSnapshot, maskPasswords, SNAPSHOT_MAX_CHARS } from "./snapshot";

test("a snapshot under the cap is returned untouched", () => {
  const text = '- button "Sign in" [ref=e2]';
  expect(capSnapshot(text)).toBe(text);
});

test("a long snapshot is cut on a line boundary with a notice", () => {
  const line = '- link "Some navigation entry" [ref=e1]\n';
  const huge = line.repeat(10_000);
  const capped = capSnapshot(huge);
  const [kept, notice] = capped.split("\n[... page cut off: ");
  expect(kept?.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
  // Every kept line is whole, so no ref is half-cut.
  expect(kept?.endsWith("[ref=e1]")).toBe(true);
  expect(notice).toMatch(/^\d+ more characters not shown/);
  expect(Number(notice?.split(" ")[0])).toBe(huge.length - (kept?.length ?? 0));
});

test("a single endless line is still capped", () => {
  const capped = capSnapshot("x".repeat(50), 20);
  expect(capped.startsWith("x".repeat(20))).toBe(true);
  expect(capped).toContain("30 more characters not shown");
});

test("a password field's value is masked; the same text elsewhere is not", () => {
  const tree = [
    '- textbox "Username" [ref=e4]: student',
    '- textbox "Password" [active] [ref=e6]: hunter22',
    '- textbox "Other" [ref=e7]: "a: b"',
    "- text: hunter22 is not a secret in prose",
  ].join("\n");
  const masked = maskPasswords(tree, ["hunter22", "a: b", ""]);
  expect(masked).toContain('- textbox "Username" [ref=e4]: student');
  expect(masked).toContain("[ref=e6]: [password hidden]");
  expect(masked).toContain("[ref=e7]: [password hidden]");
  expect(masked).toContain("- text: hunter22 is not a secret in prose");
  expect(maskPasswords(tree, [])).toBe(tree);
});
