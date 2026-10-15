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
  return tree
    .split("\n")
    .map((line) => {
      const item = ITEM_LINE.exec(line);
      if (!item) return line;
      return `${item[1]}${mapOwnAttrs(item[2] ?? "", (attrs) =>
        attrs.replace(PLAYWRIGHT_REF, `[ref=s${generation}$1]`),
      )}`;
    })
    .join("\n");
}

const ITEM_LINE = /^(\s*- )(.*)$/;
/**
 * An item's role, quoted name, then its own `[attr]` marks. The name and the
 * value after `: ` are page text, which may spell out another element's ref
 * ("Keep [ref=e7]" on a button that is e3): only the marks are the element's.
 */
const ITEM_HEAD = /^(\/?[\w-]+(?: "(?:[^"\\]|\\.)*")?)((?: \[[^\]]*\])*)/;

/** `content` (an item's line after `- `) with only its own marks rewritten. */
export function mapOwnAttrs(
  content: string,
  rewrite: (attrs: string) => string,
): string {
  return content.replace(
    ITEM_HEAD,
    (_all, head: string, attrs: string) => `${head}${rewrite(attrs)}`,
  );
}

/** The element's own ref, never one its name or text spells out. */
export function ownRef(content: string): string | undefined {
  const attrs = ITEM_HEAD.exec(content)?.[2] ?? "";
  return /\[ref=((?:f\d+)?e\d+)\]/.exec(attrs)?.[1];
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
