import type { Frame, Page } from "playwright-core";
import { unquoteItemKeys } from "./aria-keys";
import {
  documentOf,
  lookEpoch,
  previousRefs,
  rememberLook,
} from "./look-memory";
import type { BrowserTab } from "./open-tab";
import { redactUrl } from "./redact-url";
import { nextGeneration, stampRefs } from "./refs";
import { unquoted } from "./snapshot-tree";
import { FULL_VIEW, type SnapshotView, viewTree } from "./snapshot-view";
import { untrusted } from "./untrusted";

/** A GitHub page measured ~200k characters raw; the model needs a page, not a dump. */
export const SNAPSHOT_MAX_CHARS = 12_000;

/** `text` cut to `max` characters on a line boundary, and how much was cut. */
export function capText(
  text: string,
  max = SNAPSHOT_MAX_CHARS,
): { kept: string; omitted: number } {
  if (text.length <= max) return { kept: text, omitted: 0 };
  const cut = text.lastIndexOf("\n", max);
  const kept = text.slice(0, cut > 0 ? cut : max);
  return { kept, omitted: text.length - kept.length };
}

export const cutOffHint = (omitted: number) =>
  `[... page cut off: ${omitted} more characters not shown. Take a snapshot with query to find something specific, or with interactive: true for only the controls.]`;

/**
 * The page as the model reads it: title, address, and Playwright's AI-mode
 * accessibility tree, whose `[ref=sGeN]` marks are what click/fill/select take,
 * fenced as website content. Refs resolve against the LATEST look only
 * (refs.ts), so every action that changes the page returns a fresh one; a
 * filtered view starts a new generation all the same. Elements the previous
 * look at this same document did not have are marked `[new]`.
 */
export async function pageSnapshot(
  tab: BrowserTab,
  view: SnapshotView = FULL_VIEW,
  /** The epoch the look's action started in, when it is part of one. */
  epoch = lookEpoch(tab),
): Promise<string> {
  const page = tab.page;
  // Every frame: the AI snapshot descends into iframes (refs like f1e3), and
  // sign-in forms often live in one.
  const secrets = await passwordValues(page);
  const tree = await ariaTree(page);
  const title = await page.title();
  const address = redactUrl(page.url());
  const document = tree === null ? null : await documentOf(page);
  const shaped =
    tree === null || document === null
      ? null
      : viewTree({
          tree: maskPasswords(tree, secrets),
          view,
          pageUrl: page.url(),
          previous: previousRefs(tab, page, document),
        });
  const generation = nextGeneration();
  // A popup that took over meanwhile keeps its own generation, so these refs
  // (for the page underneath) read as stale instead of resolving on it.
  if (tab.page === page && lookEpoch(tab) === epoch) {
    tab.generation = generation;
    if (shaped && document !== null)
      rememberLook(tab, page, document, shaped.refs);
  }
  const head = `Page: ${title}\nAddress: ${address}`;
  if (!shaped) return `${STILL_LOADING}\n${untrusted(head)}`;
  const { kept, omitted } = capText(stampRefs(shaped.tree, generation));
  return [
    ...shaped.notes,
    untrusted(`${head}\n\n${kept}`),
    ...(omitted > 0 ? [cutOffHint(omitted)] : []),
  ].join("\n");
}

/**
 * The password fields' values in every frame, to mask in the tree. Any frame
 * whose read fails is thrown rather than risk printing a password unmasked,
 * except a frame that detached meanwhile (an iframe the page removed), which
 * is no longer in the tree either.
 */
export async function passwordValues(page: Page): Promise<string[]> {
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
export async function ariaTree(page: Page): Promise<string | null> {
  try {
    return unquoteItemKeys(
      await page.ariaSnapshot({ mode: "ai", timeout: 5_000 }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return null;
    throw error;
  }
}

/**
 * A textbox line's head (role, quoted name, `[attr]` marks) and its value.
 * Anchored on the head, not the last "]: ": a password "ab]: cd" contains
 * one, and matching there masked only its tail.
 */
const TEXTBOX_VALUE =
  /^(\s*- textbox(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*: )(.*)$/;

/**
 * The accessibility tree prints a textbox's value, password fields included.
 * Masked by value on textbox lines only, so a short password never blanks
 * ordinary page text that happens to contain it.
 */
export function maskPasswords(
  tree: string,
  secrets: readonly string[],
): string {
  const hidden = new Set(secrets.map(asPrinted).filter((s) => s.length > 0));
  if (hidden.size === 0) return tree;
  return tree
    .split("\n")
    .map((line) => {
      const match = TEXTBOX_VALUE.exec(line);
      return match?.[2] !== undefined &&
        hidden.has(asPrinted(unquoted(match[2])))
        ? `${match[1]}[password hidden]`
        : line;
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
