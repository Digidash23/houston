import type { ReactNode } from "react";
import { PageContainer } from "../shell/page-shell";
import ActivityTab from "./activity-tab";
import BillingTab from "./billing-tab";
import MembersTab from "./members-tab";
import OrgChartTab from "./org-chart-tab";
import type { OrgTabId } from "./org-view-model";
import type { OrgTabProps, OrgViewContext } from "./organization-view";

/** Each Organization section renders from the shared contract. */
const SECTION_COMPONENTS: Record<OrgTabId, (props: OrgTabProps) => ReactNode> =
  {
    orgChart: OrgChartTab,
    people: MembersTab,
    billing: BillingTab,
    activity: ActivityTab,
  };

/** Mounts the record's component AS a component, so its hooks stay its own. */
function PlainSection({
  active,
  ctx,
}: {
  active: OrgTabId;
  ctx: OrgViewContext;
}) {
  const Section = SECTION_COMPONENTS[active];
  return <Section ctx={ctx} />;
}

/**
 * The active section's body under the Admin strip. No heading of its own: the
 * header's lozenge already names the section (the shared grammar with
 * Integrations and an employee's screen), so a hero here would say it twice.
 *
 * `data-admin-section-body` names the MOUNTED section for the e2e helpers:
 * the header lozenge repaints synchronously on click, so the attribute is
 * what proves the body actually swapped under it.
 */
export function AdminSectionBody({
  active,
  ctx,
}: {
  active: OrgTabId;
  ctx: OrgViewContext;
}) {
  return (
    <PageContainer
      // The org chart's ledger takes the widest measure, so a dense one
      // can stand in two columns on a wide screen.
      className={
        active === "orgChart" ? "max-w-368 pt-6 pb-10 md:pt-10" : "pt-6 pb-10"
      }
      data-admin-section-body={active}
    >
      <PlainSection active={active} ctx={ctx} />
    </PageContainer>
  );
}
