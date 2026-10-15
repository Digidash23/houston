import { unquoted } from "./snapshot-tree";

/**
 * A textbox line's head (role, quoted name, `[attr]` marks) and its value.
 * Anchored on the head, not the last "]: ": a password "ab]: cd" contains
 * one, and matching there masked only its tail.
 */
const TEXTBOX_VALUE =
  /^(\s*- textbox(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*: )(.*)$/;

/**
 * A textbox printed with children: one with a placeholder that differs from
 * its name prints `- /placeholder:` and then its value as a `- text:` child.
 */
const TEXTBOX_PARENT =
  /^(\s*)- textbox(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*:$/;
const CHILD_TEXT = /^(\s*- text: )(.*)$/;

/**
 * The accessibility tree prints a textbox's value, password fields included.
 * Masked by value on textbox lines (and a textbox's own text children) only,
 * so a short password never blanks ordinary page text that contains it.
 */
export function maskPasswords(
  tree: string,
  secrets: readonly string[],
): string {
  const hidden = new Set(secrets.map(asPrinted).filter((s) => s.length > 0));
  if (hidden.size === 0) return tree;
  const mask = (match: RegExpExecArray | null): string | undefined =>
    match?.[2] !== undefined && hidden.has(asPrinted(unquoted(match[2])))
      ? `${match[1]}[password hidden]`
      : undefined;
  let textboxIndent: number | undefined;
  return tree
    .split("\n")
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      if (textboxIndent !== undefined && indent <= textboxIndent)
        textboxIndent = undefined;
      const parent = TEXTBOX_PARENT.exec(line);
      if (parent) {
        textboxIndent = indent;
        return line;
      }
      const own = mask(TEXTBOX_VALUE.exec(line));
      if (own !== undefined) return own;
      if (textboxIndent === undefined) return line;
      return mask(CHILD_TEXT.exec(line)) ?? line;
    })
    .join("\n");
}

/**
 * Playwright's own whitespace normalization of a printed value: a password
 * "correct  horse" prints as "correct horse" and must still match.
 */
function asPrinted(value: string): string {
  return value
    .replace(/[\u200b\u00ad]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}
