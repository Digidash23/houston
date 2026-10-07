/**
 * Label contract for the relative + absolute "next run" phrasing. A sibling of
 * `labels.ts` (that file is at its size budget); same `{token}` rules.
 */

/** Relative + absolute "next run" phrasing. `{m}`/`{h}`/`{d}`/`{day}`/`{time}`. */
export interface NextFireLabels {
  lessThanMinute: string;
  inMinutes: string;
  inHoursMinutes: string;
  inDaysHours: string;
  inDays: string;
  today: string;
  tomorrow: string;
  soon: string;
  at: string;
}
