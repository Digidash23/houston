import { expect, test } from "vitest";
import {
  capText,
  cutOffHint,
  maskPasswords,
  SNAPSHOT_MAX_CHARS,
} from "./snapshot";

test("a snapshot under the cap is returned untouched", () => {
  const text = '- button "Sign in" [ref=e2]';
  expect(capText(text)).toEqual({ kept: text, omitted: 0 });
});

test("a long snapshot is cut on a line boundary, counting what was cut", () => {
  const line = '- link "Some navigation entry" [ref=e1]\n';
  const huge = line.repeat(10_000);
  const { kept, omitted } = capText(huge);
  expect(kept.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
  // Every kept line is whole, so no ref is half-cut.
  expect(kept.endsWith("[ref=e1]")).toBe(true);
  expect(omitted).toBe(huge.length - kept.length);
});

test("a single endless line is still capped", () => {
  expect(capText("x".repeat(50), 20)).toEqual({
    kept: "x".repeat(20),
    omitted: 30,
  });
});

test("the cut-off hint points at query and interactive", () => {
  expect(cutOffHint(42)).toContain("42 more characters not shown");
  expect(cutOffHint(42)).toContain("query");
  expect(cutOffHint(42)).toContain("interactive: true");
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

test('a password holding "]: " is masked whole, not from its last "]: "', () => {
  const line = '- textbox "Secret" [active] [ref=e8]: "ab]: cd"';
  expect(maskPasswords(line, ["ab]: cd"])).toBe(
    '- textbox "Secret" [active] [ref=e8]: [password hidden]',
  );
});
