import type { OrgChartShareDetours } from "./chart-share";

export type { OrgChartShareDetours } from "./chart-share";

/**
 * A publish that failed (an unclassified answer such as a 500, an unreadable
 * body) after a retry had already got past a refused card or title. The
 * failure itself is `cause`; `detours` keeps what the earlier attempts were
 * refused for, which would otherwise be lost with them. Carries no `status`,
 * so the adapter passes it through untranslated. A failure with nothing to
 * carry is thrown as itself.
 */
export class OrgChartShareFailure extends Error {
  readonly detours: OrgChartShareDetours;

  constructor(cause: unknown, detours: OrgChartShareDetours) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "OrgChartShareFailure";
    this.detours = detours;
  }
}
