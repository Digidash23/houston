import { expect, test } from "vitest";
import { unquoteItemKeys } from "./aria-keys";
import { maskPasswords } from "./mask-passwords";
import { stampRefs } from "./refs";
import { parseTree } from "./snapshot-tree";

test("a single-quoted item key reads like any other item", () => {
  const tree = [
    "- main [ref=e1]:",
    `  - 'textbox "PIN #" [active] [ref=e7]': hunter4`,
    `  - 'link "Bob''s: page" [ref=e8]':`,
    '    - /url: "https://x.example/a: b"',
    '  - button "Plain" [ref=e9]',
  ].join("\n");
  expect(unquoteItemKeys(tree)).toBe(
    [
      "- main [ref=e1]:",
      '  - textbox "PIN #" [active] [ref=e7]: hunter4',
      `  - link "Bob's: page" [ref=e8]:`,
      '    - /url: "https://x.example/a: b"',
      '  - button "Plain" [ref=e9]',
    ].join("\n"),
  );
});

test("a quote that never closes is left as printed", () => {
  const tree = `- 'textbox "half [ref=e2]`;
  expect(unquoteItemKeys(tree)).toBe(tree);
});

test("once unquoted, the password is masked, the ref stamped and the role parsed", () => {
  const tree = unquoteItemKeys(
    `- 'textbox "PIN #" [ref=e7]': hunter4\n- 'button "Go: now" [ref=e8]'`,
  );
  const masked = maskPasswords(tree, ["hunter4"]);
  expect(masked).not.toContain("hunter4");
  expect(stampRefs(masked, 3)).toBe(
    '- textbox "PIN #" [ref=s3e7]: [password hidden]\n- button "Go: now" [ref=s3e8]',
  );
  expect(parseTree(tree).map((n) => [n.role, n.name, n.ref])).toEqual([
    ["textbox", "PIN #", "e7"],
    ["button", "Go: now", "e8"],
  ]);
});
