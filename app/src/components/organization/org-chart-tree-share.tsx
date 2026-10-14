import type { ComponentProps } from "react";
import type { OrgTree } from "./org-chart-tree";
import { OrgChartTreeView } from "./org-chart-tree-view";
import { useOrgChartShare } from "./use-org-chart-share";

/**
 * The on-screen chart wired to its Share button. The share image starts
 * drawing when this mounts, so only a chart that is on screen draws one.
 */
export function OrgChartTreeShare({
  shareTree,
  ...props
}: Omit<ComponentProps<typeof OrgChartTreeView>, "onShare"> & {
  /** The same chart under the share image's caps. */
  shareTree: OrgTree;
}) {
  const share = useOrgChartShare(shareTree, props.phone);
  return <OrgChartTreeView {...props} onShare={share} />;
}
