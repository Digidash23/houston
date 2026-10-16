import { ORG_CHART_SHARE_TITLE_MAX } from "@houston/wire-types";
import {
  BLACK_FLAG,
  flagTagsLength,
  isAcceptedOrgChartShareTitle,
  isJoiner,
  isRefusedPoint,
  isStyleSelector,
  joinerFits,
  selectorFits,
  trimTitleSpace,
} from "./chart-share-title-rule";

export { isAcceptedOrgChartShareTitle } from "./chart-share-title-rule";

/**
 * The page's title when the given one has nothing the gateway takes left.
 * Plain English like the page that shows it (the Agent Store site is
 * English-only).
 */
export const ORG_CHART_SHARE_FALLBACK_TITLE = "Our AI team";

/**
 * The title split into units: one code point, or a whole standard
 * subdivision flag. A lone surrogate is read as U+FFFD, which is what the
 * upload's UTF-8 encoding sends for it.
 */
function units(title: string): number[][] {
  const points = Array.from(
    title.replace(/\p{Cs}/gu, "�"),
    (c) => c.codePointAt(0) ?? 0,
  );
  const out: number[][] = [];
  for (let i = 0; i < points.length; ) {
    const point = points[i] ?? 0;
    const length =
      1 + (point === BLACK_FLAG ? flagTagsLength(points, i + 1) : 0);
    out.push(points.slice(i, i + length));
    i += length;
  }
  return out;
}

const isSpaceUnit = (unit: number[] | undefined) =>
  unit?.length === 1 && trimTitleSpace(String.fromCodePoint(...unit)) === "";

/**
 * The title as the gateway takes it (`chart-share-title-rule.ts`): the code
 * points it refuses everywhere stripped, trimmed, cut at
 * {@link ORG_CHART_SHARE_TITLE_MAX} code points without splitting a flag,
 * then each joiner and style selector kept only where its neighbours, as
 * kept, still allow it (a cut or a strip can leave one dangling). A title
 * the gateway would still refuse, or one with nothing left, becomes
 * {@link ORG_CHART_SHARE_FALLBACK_TITLE}.
 */
export function orgChartShareTitle(title: string): string {
  const kept = units(title).filter(
    ([point = 0, ...tags]) =>
      tags.length > 0 ||
      isJoiner(point) ||
      isStyleSelector(point) ||
      !isRefusedPoint(point),
  );
  while (isSpaceUnit(kept[0])) kept.shift();
  const cut: number[][] = [];
  let length = 0;
  for (const unit of kept) {
    if (length + unit.length > ORG_CHART_SHARE_TITLE_MAX) break;
    cut.push(unit);
    length += unit.length;
  }
  const out: number[] = [];
  cut.forEach(([point = 0, ...tags], i) => {
    const prev = out.at(-1);
    if (isStyleSelector(point) && !selectorFits(prev, point)) return;
    if (isJoiner(point) && !joinerFits(prev, point, cut[i + 1]?.[0])) return;
    out.push(point, ...tags);
  });
  // A joiner keeps only a drawn character or a virama after it, which this
  // pass never drops, so checking against the next unit as cut is enough.
  const text = trimTitleSpace(String.fromCodePoint(...out));
  return isAcceptedOrgChartShareTitle(text)
    ? text
    : ORG_CHART_SHARE_FALLBACK_TITLE;
}
