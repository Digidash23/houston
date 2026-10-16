import { ORG_CHART_SHARE_TITLE_MAX } from "@houston/wire-types";

/**
 * The org chart share's title as the gateway takes it. The gateway refuses a
 * title rather than cleaning it, so the client strips everything it would
 * refuse: control (Cc), format (Cf) and default-ignorable code points
 * (bidi overrides, zero-width spaces, variation selectors, tag characters).
 * Three spellings of emoji survive, because emoji need them:
 *  - the zero-width joiner, the glue of a family or a profession emoji;
 *  - U+FE0E / U+FE0F (text or emoji presentation, as in "❤️") right after a
 *    visible character, once;
 *  - the three standard subdivision flags (England, Scotland, Wales) whole:
 *    U+1F3F4, the tag letters, U+E007F.
 */

/**
 * The page's title when the given one has nothing printable left. Plain
 * English like the page that shows it (the Agent Store site is English-only).
 */
export const ORG_CHART_SHARE_FALLBACK_TITLE = "Our AI team";

const ZWJ = "‍";
const PRESENTATION = /^[︎️]$/u;
const REFUSED = /^[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]$/u;
const SPACE = /^\s$/u;
/** England, Scotland, Wales: U+1F3F4, tag letters gbeng / gbsct / gbwls, CANCEL TAG. */
const STANDARD_FLAG =
  /\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/uy;

/** The title split into code points, with a standard flag as one unit. */
function units(title: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < title.length) {
    STANDARD_FLAG.lastIndex = i;
    const flag = STANDARD_FLAG.exec(title);
    const unit = flag?.[0] ?? String.fromCodePoint(title.codePointAt(i) ?? 0);
    out.push(unit);
    i += unit.length;
  }
  return out;
}

/** The units the gateway keeps, in order. */
function kept(title: string): string[] {
  const out: string[] = [];
  let afterVisible = false;
  for (const unit of units(title)) {
    if (unit === ZWJ) {
      out.push(unit);
      afterVisible = false;
    } else if (PRESENTATION.test(unit)) {
      if (afterVisible) out.push(unit);
      afterVisible = false;
    } else if (!REFUSED.test(unit)) {
      // A refused code point is dropped without ending the visible run
      // before it: what the gateway judges is the title as sent.
      out.push(unit);
      afterVisible = !SPACE.test(unit);
    }
  }
  return out;
}

const isSpace = (unit: string | undefined) =>
  unit !== undefined && SPACE.test(unit);

/**
 * The title as the gateway takes it (see above), trimmed, and cut at
 * {@link ORG_CHART_SHARE_TITLE_MAX} code points so a cut never splits an
 * emoji or a flag. A title with nothing visible left becomes
 * {@link ORG_CHART_SHARE_FALLBACK_TITLE}.
 */
export function orgChartShareTitle(title: string): string {
  const all = kept(title);
  while (isSpace(all[0])) all.shift();
  const cut: string[] = [];
  let points = 0;
  for (const unit of all) {
    const size = Array.from(unit).length;
    if (points + size > ORG_CHART_SHARE_TITLE_MAX) break;
    cut.push(unit);
    points += size;
  }
  while (isSpace(cut.at(-1))) cut.pop();
  const text = cut.join("");
  return /[^\s‍]/u.test(text) ? text : ORG_CHART_SHARE_FALLBACK_TITLE;
}
