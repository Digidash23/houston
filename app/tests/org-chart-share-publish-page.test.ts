import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type {
  OrgChartShareInput,
  OrgChartShareResult,
} from "@houston/engine-adapter";
import { OrgChartShareFailure } from "@houston/sdk/org/chart-share-failure";
import {
  publishPage,
  type SharePublishJob,
} from "../src/components/organization/org-chart-share-publish-page.ts";

const PAGE = "https://agents.gethouston.ai/o/AbCdEfGhIjKlMnOpQrSt_-";
const PUBLISHED: OrgChartShareResult = {
  kind: "published",
  id: "AbCdEfGhIjKlMnOpQrSt_-",
  imageUrl: "https://gateway.gethouston.ai/v1/org-chart-shares/x/image",
  pageUrl: PAGE,
};
const CARD = new Blob(["card"], { type: "image/png" });

/** A promise this test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function harness(
  answer: (input: OrgChartShareInput) => Promise<unknown>,
  cardDeadlineMs?: number,
) {
  const sent: OrgChartShareInput[] = [];
  const reports: string[] = [];
  const errors: unknown[] = [];
  const deps = {
    publish: (input: OrgChartShareInput) => {
      sent.push(input);
      return answer(input) as Promise<OrgChartShareResult>;
    },
    report: (command: string, error: unknown) => {
      reports.push(command);
      errors.push(error);
    },
    cardDeadlineMs,
  };
  const publish = (
    job: SharePublishJob,
    signal = new AbortController().signal,
  ) => publishPage(deps, job, signal);
  return { publish, sent, reports, errors };
}

const job = (image: File, card = async () => CARD): SharePublishJob => ({
  image,
  title: "Acme",
  card,
  deployment: { spaces: true },
});
const png = () =>
  new File(["png"], "acme-org-chart.png", { type: "image/png" });

describe("publishPage", () => {
  it("publishes the chart with its card and answers the page", async () => {
    const h = harness(async () => PUBLISHED);
    const image = png();
    strictEqual(await h.publish(job(image)), PAGE);
    strictEqual(h.sent.length, 1);
    strictEqual(h.sent[0]?.image, image);
    strictEqual(h.sent[0]?.preview, CARD);
    deepStrictEqual(h.sent[0]?.deployment, { spaces: true });
    deepStrictEqual(h.reports, []);
  });

  it("answers null and says nothing when aborted mid-upload", async () => {
    const answer = deferred<OrgChartShareResult>();
    const h = harness(() => answer.promise);
    const run = new AbortController();
    const page = h.publish(job(png()), run.signal);
    await settle();
    run.abort(new DOMException("closed", "AbortError"));
    strictEqual(h.sent[0]?.signal?.aborted, true);
    answer.reject(new DOMException("closed", "AbortError"));
    strictEqual(await page, null);
    deepStrictEqual(h.reports, []);
  });

  it("fails quietly on a refusal nothing in Houston caused", async () => {
    for (const code of [
      "unavailable",
      "offline",
      "timed_out",
      "account_deleted",
    ] as const) {
      const h = harness(async () => ({ kind: "refused", code }));
      strictEqual(await h.publish(job(png())), null);
      deepStrictEqual(h.reports, []);
    }
  });

  it("reports a refusal of what it drew, and a failure, once each", async () => {
    const refused = harness(async () => ({
      kind: "refused",
      code: "invalid_title",
    }));
    await refused.publish(job(png()));
    deepStrictEqual(refused.reports, ["org_chart_share_publish"]);
    const broken = harness(async () => {
      throw new Error("500");
    });
    strictEqual(await broken.publish(job(png())), null);
    deepStrictEqual(broken.reports, ["org_chart_share_publish"]);
  });

  it("reports the card and the title a failed retry got past, beside the failure itself", async () => {
    const cause = new Error("500");
    const h = harness(async () => {
      throw new OrgChartShareFailure(cause, {
        previewRefused: "invalid_preview_size",
        titleRefused: true,
      });
    });
    strictEqual(await h.publish(job(png())), null);
    deepStrictEqual(h.reports, [
      "org_chart_share_card",
      "org_chart_share_publish",
      "org_chart_share_publish",
    ]);
    strictEqual(h.errors[2], cause);
  });

  it("answers a page the gateway took without its card, and reports the card once", async () => {
    const h = harness(async () => ({
      ...PUBLISHED,
      previewRefused: "invalid_preview_size",
    }));
    strictEqual(await h.publish(job(png())), PAGE);
    deepStrictEqual(h.reports, ["org_chart_share_card"]);
  });

  it("reports the card and the title it got past once each, on a page or a refusal", async () => {
    const published = harness(async () => ({
      ...PUBLISHED,
      titleRefused: true,
    }));
    strictEqual(await published.publish(job(png())), PAGE);
    deepStrictEqual(published.reports, ["org_chart_share_publish"]);
    const limited = harness(async () => ({
      kind: "refused",
      code: "rate_limited",
      previewRefused: "invalid_preview_size",
    }));
    strictEqual(await limited.publish(job(png())), null);
    deepStrictEqual(limited.reports, ["org_chart_share_card"]);
  });

  it("publishes the chart without its card when the card cannot be drawn", async () => {
    const h = harness(async () => PUBLISHED);
    const page = await h.publish(
      job(png(), async () => {
        throw new Error("no canvas");
      }),
    );
    strictEqual(h.sent[0]?.preview, undefined);
    strictEqual(page, PAGE);
    deepStrictEqual(h.reports, ["org_chart_share_card"]);
  });

  it("publishes without the card once it outlasts its deadline, and ignores it after", async () => {
    const card = deferred<Blob>();
    const h = harness(async () => PUBLISHED, 5);
    const page = await h.publish(job(png(), () => card.promise));
    strictEqual(h.sent.length, 1);
    strictEqual(h.sent[0]?.preview, undefined);
    strictEqual(page, PAGE);
    deepStrictEqual(h.reports, ["org_chart_share_card"]);
    card.reject(new Error("late"));
    await settle();
    deepStrictEqual(h.reports, ["org_chart_share_card"]);
  });

  it("sends nothing, and reports nothing, when aborted while the card was drawing", async () => {
    const card = deferred<Blob>();
    const h = harness(async () => PUBLISHED);
    const run = new AbortController();
    const page = h.publish(
      job(png(), () => card.promise),
      run.signal,
    );
    run.abort();
    card.reject(new Error("canvas lost"));
    strictEqual(await page, null);
    deepStrictEqual(h.sent, []);
    deepStrictEqual(h.reports, []);
  });
});
