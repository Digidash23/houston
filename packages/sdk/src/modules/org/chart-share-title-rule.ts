import { ORG_CHART_SHARE_TITLE_MAX } from "@houston/wire-types";

/**
 * The gateway's rule for an org chart share's title (contract C25, cloud
 * `orgchartroutes.validTitle`), ported code point for code point so the
 * client can check a title before spending an upload on it. The gateway
 * refuses a title rather than cleaning it.
 *
 * A title is trimmed of Unicode White_Space (Go's `strings.TrimSpace`), then
 * holds 1 to {@link ORG_CHART_SHARE_TITLE_MAX} code points with no control
 * (Cc), format (Cf), default-ignorable or variation selector code point, but
 * for three emoji and script spellings:
 *  - the zero-width joiner and non-joiner, each after a drawn character, a
 *    mark or U+FE0F, and before a drawn character (a ZWJ may also come
 *    before an Indic virama when a drawn character precedes it);
 *  - one U+FE0E or U+FE0F right after a drawn character;
 *  - the tag letters of the three standard subdivision flags (England,
 *    Scotland, Wales), only inside one.
 * Lone surrogates are not text the gateway can receive, so they are refused.
 */

export const ZERO_WIDTH_JOINER = 0x200d;
const ZERO_WIDTH_NON_JOINER = 0x200c;
const TEXT_STYLE = 0xfe0e;
const EMOJI_STYLE = 0xfe0f;
export const BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;

const is = (pattern: RegExp) => (point: number) =>
  pattern.test(String.fromCodePoint(point));
const isMark = is(/^\p{M}$/u);
const isSpace = is(/^\p{White_Space}$/u);
const isControl = is(/^\p{Cc}$/u);
const isFormat = is(/^\p{Cf}$/u);
const isVariationSelector = is(/^\p{Variation_Selector}$/u);
// Go names Other_Default_Ignorable_Code_Point; the derived property this
// engine knows adds only Cf and variation selectors, refused anyway.
const isIgnorable = is(/^\p{Default_Ignorable_Code_Point}$/u);

/** The Indic virama signs a zero-width joiner may come before. */
const VIRAMAS = new Set([
  0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d4d,
  0x0dca,
]);

/** The tag runs after U+1F3F4 that complete gbeng, gbsct and gbwls. */
const SUBDIVISION_FLAGS = ["gbeng", "gbsct", "gbwls"].map((code) => [
  ...Array.from(code, (c) => 0xe0000 + c.charCodeAt(0)),
  CANCEL_TAG,
]);

/** Whether `point` draws something: not a mark, space, control or format. */
function visibleBase(point: number | undefined): boolean {
  return (
    point !== undefined &&
    !isMark(point) &&
    !isSpace(point) &&
    !isControl(point) &&
    !isFormat(point)
  );
}

/**
 * How many code points from `from` complete a standard subdivision flag
 * (the U+1F3F4 sits just before `from`), or 0 when they do not.
 */
export function flagTagsLength(points: readonly number[], from: number) {
  const flag = SUBDIVISION_FLAGS.find((tags) =>
    tags.every((tag, i) => points[from + i] === tag),
  );
  return flag?.length ?? 0;
}

export const isJoiner = (point: number) =>
  point === ZERO_WIDTH_JOINER || point === ZERO_WIDTH_NON_JOINER;
export const isStyleSelector = (point: number) =>
  point === TEXT_STYLE || point === EMOJI_STYLE;

/** Whether the gateway refuses `point` wherever it stands. */
export function isRefusedPoint(point: number): boolean {
  return (
    isVariationSelector(point) ||
    isJoiner(point) ||
    isControl(point) ||
    isIgnorable(point) ||
    isFormat(point)
  );
}

/** The gateway's `joins`: a (non-)joiner between `prev` and `next`. */
export function joinerFits(
  prev: number | undefined,
  joiner: number,
  next: number | undefined,
): boolean {
  if (prev === undefined || next === undefined) return false;
  if (!visibleBase(prev) && !isMark(prev) && prev !== EMOJI_STYLE) return false;
  return (
    visibleBase(next) ||
    (joiner === ZERO_WIDTH_JOINER && visibleBase(prev) && VIRAMAS.has(next))
  );
}

/** A style selector after `prev`; any other variation selector never fits. */
export function selectorFits(
  prev: number | undefined,
  selector: number,
): boolean {
  return isStyleSelector(selector) && visibleBase(prev);
}

/** Go's `strings.TrimSpace`: Unicode White_Space off both ends. */
export function trimTitleSpace(title: string): string {
  return title.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

/** Whether the gateway takes `title` as an org chart share's title. */
export function isAcceptedOrgChartShareTitle(title: string): boolean {
  if (/\p{Cs}/u.test(title)) return false;
  const points = Array.from(
    trimTitleSpace(title),
    (c) => c.codePointAt(0) ?? 0,
  );
  if (points.length === 0 || points.length > ORG_CHART_SHARE_TITLE_MAX)
    return false;
  for (let i = 0; i < points.length; i++) {
    const point = points[i] ?? 0;
    if (point === BLACK_FLAG) {
      i += flagTagsLength(points, i + 1);
    } else if (isVariationSelector(point)) {
      if (!selectorFits(points[i - 1], point)) return false;
    } else if (isJoiner(point)) {
      if (!joinerFits(points[i - 1], point, points[i + 1])) return false;
    } else if (isRefusedPoint(point)) {
      return false;
    }
  }
  return true;
}
