import type { SpecimenProp } from "../../../src/specimen";

/**
 * `ScheduleBuilderProps`, read off `ui/routines/src/schedule-builder.tsx`.
 * Data only — the page beside this file renders it.
 */
export const builderProps: readonly SpecimenProp[] = [
  {
    name: "value",
    type: "string",
    note: "Required. The cron expression the builder seeds its preset and fields from.",
  },
  {
    name: "onChange",
    type: "(cronExpression: string) => void",
    note: "Required. Fires on every field change with the newly derived cron.",
  },
  {
    name: "presets",
    type: "SchedulePreset[]",
    note: "Defaults to all six: every_30min, hourly, daily, weekly, monthly, custom.",
  },
  {
    name: "labels",
    type: "ScheduleLabels",
    note: "Every visible string, including the summary templates. Defaults to `DEFAULT_SCHEDULE_LABELS`.",
  },
  {
    name: "locale",
    type: "string",
    note: 'Defaults to `"en-US"`. Day names and clock format in the summary come from `Intl`.',
  },
  {
    name: "minIntervalMinutes",
    type: "number",
    note: 'A plan\'s floor between fires. A minimum on the custom minutes count (minus stops there, a lower typed count snaps up on blur), hides any preset nominally faster, shows `labels.minIntervalHint`, and emits "" for a pick under it. Absent = no limit.',
  },
];
