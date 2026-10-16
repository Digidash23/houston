import type {
  OrgChartShareInput,
  OrgChartShareResult,
} from "@houston/engine-adapter";
import {
  type OrgChartShareDetours,
  OrgChartShareFailure,
} from "@houston/sdk/org/chart-share-failure";
import { isExpectedOrgChartShareRefusal } from "@houston/wire-types";

/**
 * One publish of the chart's page: draw the link card (within
 * {@link LINK_CARD_DEADLINE_MS}), upload the chart with it, and answer the
 * page's address. DOM-free.
 */

/** How long the link card may take to draw before the chart goes up without it. */
export const LINK_CARD_DEADLINE_MS = 10_000;

export interface SharePublishDeps {
  /** `sdk.org.publishOrgChartShare`, bound. */
  publish: (input: OrgChartShareInput) => Promise<OrgChartShareResult>;
  report: (command: string, error: unknown) => void;
  /** {@link LINK_CARD_DEADLINE_MS} unless a test says otherwise. */
  cardDeadlineMs?: number;
}

/** One drawing's publish. */
export interface SharePublishJob {
  image: File;
  title: string;
  /** Draws the 1200 x 630 link card around `image`. */
  card: (image: File) => Promise<Blob>;
  deployment: OrgChartShareInput["deployment"];
}

/**
 * The card, or none: one that fails or outlasts its deadline is reported
 * and the chart goes up without it (the page then previews the square
 * chart). Once the deadline passed or `signal` aborted (the dialog closed,
 * the chart was redrawn) nothing waits on the card, so what it does later is
 * not reported: the deadline already was, and an abandoned card is nobody's
 * problem.
 */
function drawCard(
  deps: SharePublishDeps,
  job: SharePublishJob,
  signal: AbortSignal,
): Promise<Blob | undefined> {
  const ms = deps.cardDeadlineMs ?? LINK_CARD_DEADLINE_MS;
  return new Promise((resolve) => {
    let done = false;
    const finish = (card: Blob | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(card);
    };
    const onAbort = () => finish(undefined);
    const timer = setTimeout(() => {
      if (done) return;
      deps.report(
        "org_chart_share_card",
        new DOMException(`link card not drawn in ${ms} ms`, "TimeoutError"),
      );
      finish(undefined);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    let card: Promise<Blob>;
    try {
      card = job.card(job.image);
    } catch (error) {
      card = Promise.reject(error);
    }
    card.then(finish, (error: unknown) => {
      if (done) return;
      deps.report("org_chart_share_card", error);
      finish(undefined);
    });
  });
}

/**
 * What the publish got past (a card or a title the gateway refused), each
 * reported once whatever the answer, a failure included: the client drew or
 * wrote it wrong.
 */
function reportDetours(deps: SharePublishDeps, detours: OrgChartShareDetours) {
  if (detours.previewRefused)
    deps.report(
      "org_chart_share_card",
      new Error(`link card refused: ${detours.previewRefused}`),
    );
  if (detours.titleRefused)
    deps.report(
      "org_chart_share_publish",
      new Error("org chart share title refused: invalid_title"),
    );
}

/**
 * The page's address, or null to share without it. Never rejects. Only a
 * refusal nothing outside Houston explains, or a failure, is reported, and
 * a card or title the gateway refused on the way is reported once; an
 * aborted publish says nothing.
 */
export async function publishPage(
  deps: SharePublishDeps,
  job: SharePublishJob,
  signal: AbortSignal,
): Promise<string | null> {
  const preview = await drawCard(deps, job, signal);
  if (signal.aborted) return null;
  try {
    const result = await deps.publish({
      image: job.image,
      preview,
      title: job.title,
      deployment: job.deployment,
      signal,
    });
    reportDetours(deps, result);
    if (result.kind === "published") return result.pageUrl;
    if (!isExpectedOrgChartShareRefusal(result.code))
      deps.report(
        "org_chart_share_publish",
        new Error(`org chart share refused: ${result.code}`),
      );
  } catch (error) {
    if (signal.aborted) return null;
    if (error instanceof OrgChartShareFailure) {
      reportDetours(deps, error.detours);
      deps.report("org_chart_share_publish", error.cause);
    } else deps.report("org_chart_share_publish", error);
  }
  return null;
}
