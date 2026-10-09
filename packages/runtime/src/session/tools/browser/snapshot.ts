import type { Page } from "playwright-core";

/** A GitHub page measured ~200k characters raw; the model needs a page, not a dump. */
export const SNAPSHOT_MAX_CHARS = 12_000;

/** Trim a snapshot to `max` characters on a line boundary, saying so. */
export function capSnapshot(text: string, max = SNAPSHOT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max);
  const kept = text.slice(0, cut > 0 ? cut : max);
  return `${kept}\n[... page cut off: ${text.length - kept.length} more characters not shown. Use wait with text to find something specific, or open a more specific page.]`;
}

/**
 * The page as the model reads it: title, address, and Playwright's AI-mode
 * accessibility tree, whose `[ref=eN]` marks are what click/fill/select take.
 * Refs resolve against the LATEST snapshot only, so every action that changes
 * the page returns a fresh one.
 */
export async function pageSnapshot(page: Page): Promise<string> {
  // Every frame: the AI snapshot descends into iframes (refs like f1e3), and
  // sign-in forms often live in one.
  const perFrame = await Promise.all(
    page
      .frames()
      .map((frame) =>
        frame
          .locator('input[type="password"]')
          .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value),
          ),
      ),
  );
  const secrets = perFrame.flat();
  const tree = await page.ariaSnapshot({ mode: "ai", timeout: 10_000 });
  const title = await page.title();
  return capSnapshot(
    `Page: ${title}\nAddress: ${page.url()}\n\n${maskPasswords(tree, secrets)}`,
  );
}

const TEXTBOX_VALUE = /^(\s*- textbox\b.*\]: )(.*)$/;

/**
 * The accessibility tree prints a textbox's value, password fields included.
 * Masked by value on textbox lines only, so a short password never blanks
 * ordinary page text that happens to contain it.
 */
export function maskPasswords(
  tree: string,
  secrets: readonly string[],
): string {
  const hidden = new Set(secrets.filter((s) => s.length > 0));
  if (hidden.size === 0) return tree;
  return tree
    .split("\n")
    .map((line) => {
      const match = TEXTBOX_VALUE.exec(line);
      return match?.[2] !== undefined && hidden.has(unquoted(match[2]))
        ? `${match[1]}[password hidden]`
        : line;
    })
    .join("\n");
}

/** The tree YAML-quotes a value with special characters ("a: b"). */
function unquoted(value: string): string {
  if (!value.startsWith('"')) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    // Not JSON-quoted after all: compare it as printed.
    return value;
  }
}
