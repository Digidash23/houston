import { BrowserToolError } from "./errors";

/**
 * Process-wide, so two tabs (or one tab before and after a popup) never hand
 * out the same prefix: a ref printed for one page can never resolve on another.
 */
let generations = 0;

/** The next snapshot generation. */
export function nextGeneration(): number {
  generations += 1;
  return generations;
}

const PLAYWRIGHT_REF = /\[ref=((?:f\d+)?e\d+)\]/g;
const STAMPED_REF = /^s(\d+)((?:f\d+)?e\d+)$/;

/**
 * Prefix every Playwright ref in a snapshot with its generation (`e12` →
 * `s7e12`, `f1e3` → `s7f1e3`). Playwright reuses `e12` for a different
 * element once the page changes, so a bare ref from an older look at the page
 * could click the wrong thing; the prefix makes that a refusal instead.
 */
export function stampRefs(tree: string, generation: number): string {
  return tree.replace(PLAYWRIGHT_REF, `[ref=s${generation}$1]`);
}

/**
 * The bare Playwright ref behind a stamped one, when it comes from the tab's
 * latest snapshot; anything else is refused as stale.
 */
export function resolveRef(tab: { generation: number }, raw: string): string {
  const match = STAMPED_REF.exec(raw);
  if (!match?.[2] || Number(match[1]) !== tab.generation)
    throw new BrowserToolError(
      "stale_ref",
      "That ref is from an older look at the page (it changed since). Take a snapshot and use a ref from it, exactly as printed (like s7e12).",
    );
  return match[2];
}
