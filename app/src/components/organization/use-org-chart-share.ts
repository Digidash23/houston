import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { analytics } from "../../lib/analytics";
import { logAndReportError } from "../../lib/error-report";
import { openExternalUrl } from "../../lib/open-external-url";
import { useUIStore } from "../../stores/ui";
import { browserShareDeps } from "./org-chart-share-browser";
import { type ShareChannel, sharePostText } from "./org-chart-share-model";
import {
  type ShareOutcome,
  type ShareRunDeps,
  shareLanding,
  shareOrgChart,
  usesShareSheet,
} from "./org-chart-share-run";
import type { OrgTree } from "./org-chart-tree";
import {
  type Departure,
  liveClock,
  livePage,
  showWhenBack,
  watchDeparture,
} from "./org-chart-when-seen";
import { createSingleFlight } from "./single-flight";
import { useShareCardImage } from "./use-share-card-image";

/** Counts only: no names ride a share event. */
function track(channel: ShareChannel, tree: OrgTree) {
  analytics.track("org_chart_shared", {
    share_channel: channel,
    agent_count: tree.counts.agents,
    people_count: tree.counts.people,
  });
}

/**
 * The Share button: one click, no dialog. The image is drawn ahead of the
 * click (`useShareCardImage`), so the click only hands it on. A click while
 * a LinkedIn share is still running is dropped (a double click would open
 * it twice); the share sheet is left ungated, since a sheet that never
 * settles would kill the button and a second tap is already quiet. The
 * toast says where the image went once the person is back from LinkedIn,
 * and carries LinkedIn's link when the browser blocked the tab. Unexpected
 * failures report and show nothing.
 */
export function useOrgChartShare(tree: OrgTree, phone: boolean) {
  const { t } = useTranslation("teams");
  const image = useShareCardImage(tree);
  const flight = useRef(createSingleFlight());
  const pending = useRef(new Set<() => void>());
  // A share that lands after unmount must not register a toast nobody drains.
  const disposed = useRef(false);
  useEffect(() => {
    disposed.current = false;
    const cancels = pending.current;
    return () => {
      disposed.current = true;
      for (const cancel of cancels) cancel();
      cancels.clear();
    };
  }, []);

  const land = (outcome: ShareOutcome, departure: Departure) => {
    const landing = shareLanding(outcome, isTauri());
    if (landing.channel) track(landing.channel, tree);
    const { toast, blocked } = landing;
    if (!toast || disposed.current) return departure.stop();
    // A stop left in the set after its toast showed is a harmless no-op.
    const cancel = showWhenBack(
      livePage(),
      () => {
        departure.stop();
        useUIStore.getState().addToast({
          variant: "info",
          title: t(
            toast === "blocked"
              ? "orgChart.share.linkedInBlocked"
              : `orgChart.share.${toast}`,
          ),
          action:
            blocked && outcome.kind === "linkedin"
              ? {
                  label: t("orgChart.share.openLinkedIn"),
                  onClick: () => {
                    track(blocked, tree);
                    void openExternalUrl(outcome.url);
                  },
                }
              : undefined,
        });
      },
      {
        departure,
        expectLeave: outcome.kind === "linkedin" && outcome.opened,
        clock: liveClock,
      },
    );
    pending.current.add(() => {
      cancel();
      departure.stop();
    });
  };

  // Nothing is awaited before the run starts: the clipboard write and the
  // open must stay inside the click. A synchronous throw (a name
  // encodeURIComponent refuses) reports like any other failure.
  const run = (deps: ShareRunDeps, departure: Departure): Promise<void> => {
    const fail = (error: unknown) => {
      departure.stop();
      logAndReportError("org_chart_share", error);
    };
    try {
      return shareOrgChart(deps)
        .then((outcome) => land(outcome, departure))
        .catch(fail);
    } catch (error) {
      fail(error);
      return Promise.resolve();
    }
  };

  return () => {
    try {
      const deps = browserShareDeps(sharePostText(t, tree), image(), phone);
      if (usesShareSheet(deps)) {
        void run(deps, watchDeparture(livePage()));
        return;
      }
      flight.current(() => run(deps, watchDeparture(livePage())));
    } catch (error) {
      logAndReportError("org_chart_share", error);
    }
  };
}
