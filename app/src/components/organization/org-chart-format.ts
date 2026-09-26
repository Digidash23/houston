/**
 * The org chart's number and chart geometry. Pure and DOM-free.
 */

/** U+202F, the narrow no-break space SI digit grouping uses. */
const THIN_GROUP = String.fromCharCode(0x202f);

/**
 * A number with its digits grouped by a thin space (12 140), the SI way: it
 * reads the same in every language the app ships, where a comma or a period
 * would mean a thousands mark in one and a decimal point in another. The
 * decimal mark stays the locale's own.
 */
export function formatCount(
  value: number,
  locale: string,
  fractionDigits = 0,
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: fractionDigits,
  })
    .formatToParts(value)
    .map((part) => (part.type === "group" ? THIN_GROUP : part.value))
    .join("");
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface WorkFigure {
  /** The formatted number, locale decimal mark included. */
  value: string;
  /** The numeric value the unit's plural agrees with. */
  count: number;
  unit: "hours" | "minutes";
}

/**
 * Time worked as one figure with its unit. Under an hour it counts minutes
 * (a few minutes of work is not "0 hours"); under ten hours it keeps one
 * decimal; above that whole hours, the way a month of work is read.
 */
export function formatWork(ms: number, locale: string): WorkFigure {
  if (ms > 0 && ms < HOUR_MS) {
    const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
    return {
      value: formatCount(minutes, locale),
      count: minutes,
      unit: "minutes",
    };
  }
  const hours = Math.max(0, ms) / HOUR_MS;
  const digits = hours < 10 ? 1 : 0;
  const count = Number(hours.toFixed(digits));
  return { value: formatCount(count, locale, digits), count, unit: "hours" };
}

export interface AreaChartGeometry {
  /** `points` for the polyline. */
  line: string;
  /** `points` for the area polygon under it, closed along the baseline. */
  area: string;
  /** The baseline's y. */
  base: number;
  end: { x: number; y: number };
}

const fixed = (n: number) => Number(n.toFixed(1));

/**
 * The hero's area chart inside a `width` x `height` box: 3px in from either
 * side so the end dot is never clipped, the peak at 8% under the top and the
 * baseline on the floor. The scale starts at zero, so a quiet day sits on
 * the baseline and a silent month lies flat along it rather than floating.
 */
export function areaChart(
  values: readonly number[],
  width: number,
  height: number,
): AreaChartGeometry {
  const series = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const top = Math.max(...series) * 1.08 || 1;
  const base = height - 1;
  const points = series.map((value, index) => ({
    x: fixed(3 + (index / (series.length - 1)) * (width - 6)),
    y: fixed(4 + (1 - Math.max(0, value) / top) * (base - 4)),
  }));
  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const first = points[0] ?? { x: 0, y: base };
  const end = points[points.length - 1] ?? first;
  return {
    line,
    area: `${first.x},${base} ${line} ${end.x},${base}`,
    base,
    end,
  };
}

/**
 * A calendar label for a UTC day (`YYYY-MM-DD`). Pinned to UTC because usage
 * is bucketed by UTC day: the viewer's own zone would name every day one
 * off west of Greenwich.
 */
export function dayLabel(
  language: string,
  day: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(language, {
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}
