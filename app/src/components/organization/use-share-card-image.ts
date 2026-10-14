import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { logAndReportError } from "../../lib/error-report";
import { renderShareCard } from "./org-chart-share-card";
import type { ShareCardText } from "./org-chart-share-card-paint";
import { shareFileName, shareTitle } from "./org-chart-share-model";
import type { OrgTree } from "./org-chart-tree";

type Translate = ReturnType<typeof useTranslation<"teams">>["t"];

/** One drawing of the share PNG. `ready` is set once it lands. */
export interface ShareImageDraw {
  png: Promise<File>;
  ready: File | null;
  failed: boolean;
}

function draw(tree: OrgTree, t: Translate): ShareImageDraw {
  const title = shareTitle(tree);
  const agents = t("orgChart.agentCount", { count: tree.counts.agents });
  const text: ShareCardText = {
    title,
    counts:
      tree.root.kind === "person"
        ? agents
        : t("orgChart.share.cardCounts", {
            people: t("orgChart.peopleCount", { count: tree.counts.people }),
            agents,
          }),
    site: t("orgChart.share.site"),
    more: (count) => t("orgChart.more", { count }),
  };
  const entry: ShareImageDraw = {
    png: renderShareCard(tree, text, {
      people: (count) => t("orgChart.peopleCount", { count }),
      agents: (count) => t("orgChart.agentCount", { count }),
    }).then(
      (blob) => new File([blob], shareFileName(title), { type: "image/png" }),
    ),
    ready: null,
    failed: false,
  };
  entry.png.then(
    (file) => {
      entry.ready = file;
    },
    (error: unknown) => {
      entry.failed = true;
      logAndReportError("org_chart_share_image", error);
    },
  );
  return entry;
}

/**
 * The share PNG for `tree`, drawn ahead of the click: as soon as the chart
 * is on screen, and again whenever what it draws changes (`tree` keeps its
 * identity across identical reloads), so Share is instant. `current()` is
 * the latest drawing, still under way or done; one that failed is drawn
 * again on the next call.
 */
export function useShareCardImage(tree: OrgTree) {
  const { t } = useTranslation("teams");
  const latest = useRef<{ tree: OrgTree; draw: ShareImageDraw } | null>(null);

  useEffect(() => {
    latest.current = { tree, draw: draw(tree, t) };
  }, [tree, t]);

  return useCallback((): ShareImageDraw => {
    const held = latest.current;
    if (held && held.tree === tree && !held.draw.failed) return held.draw;
    latest.current = { tree, draw: draw(tree, t) };
    return latest.current.draw;
  }, [tree, t]);
}
