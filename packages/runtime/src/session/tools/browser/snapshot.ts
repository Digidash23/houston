import type { Frame, Page } from "playwright-core";
import type { BrowserTab } from "./open-tab";
import { redactUrl } from "./redact-url";
import { nextGeneration, stampRefs } from "./refs";

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
 * accessibility tree, whose `[ref=sGeN]` marks are what click/fill/select take.
 * Refs resolve against the LATEST snapshot only (refs.ts), so every action
 * that changes the page returns a fresh one. Only a snapshot the model reads
 * starts a new generation.
 */
export async function pageSnapshot(tab: BrowserTab): Promise<string> {
  const page = tab.page;
  // Every frame: the AI snapshot descends into iframes (refs like f1e3), and
  // sign-in forms often live in one.
  const secrets = await passwordValues(page);
  const tree = await ariaTree(page);
  const title = await page.title();
  const generation = nextGeneration();
  // A popup that took over meanwhile keeps its own generation, so these refs
  // (for the page underneath) read as stale instead of resolving on it.
  if (tab.page === page) tab.generation = generation;
  const stamped = stampRefs(maskPasswords(tree, secrets), generation);
  return capSnapshot(
    `Page: ${title}\nAddress: ${redactUrl(page.url())}\n\n${stamped}`,
  );
}

/**
 * The password fields' values in every frame, to mask in the tree. Any frame
 * whose read fails is thrown rather than risk printing a password unmasked,
 * except a frame that detached meanwhile (an iframe the page removed), which
 * is no longer in the tree either.
 */
async function passwordValues(page: Page): Promise<string[]> {
  const perFrame = await Promise.all(page.frames().map(framePasswords));
  return perFrame.flat();
}

const readPasswords = (frame: Frame): Promise<string[]> =>
  frame
    .locator('input[type="password"]')
    .evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value),
    );

/**
 * An iframe that navigates during the read stays attached but destroys the
 * context being read ("Execution context was destroyed"): its new document is
 * read once more, and only a second failure fails the snapshot.
 */
async function framePasswords(frame: Frame): Promise<string[]> {
  try {
    return await readPasswords(frame);
  } catch {
    // Not dropped: the retry's own failure is what gets thrown.
    if (frame.isDetached()) return [];
    try {
      return await readPasswords(frame);
    } catch (retryError) {
      if (frame.isDetached()) return [];
      throw retryError;
    }
  }
}

export const STILL_LOADING =
  "(The page is still loading and has nothing to read yet. Wait a few seconds, then take a snapshot again.)";

/**
 * The tree waits for the page's body, which a slow parser-blocking script in
 * the head holds back. That page is loading, not broken: the model is told
 * so instead of getting a timeout that reads like its action failed.
 */
async function ariaTree(page: Page): Promise<string> {
  try {
    return await page.ariaSnapshot({ mode: "ai", timeout: 5_000 });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError")
      return STILL_LOADING;
    throw error;
  }
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
