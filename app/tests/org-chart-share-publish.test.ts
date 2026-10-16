import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type {
  OrgChartShareInput,
  OrgChartShareResult,
} from "@houston/engine-adapter";
import {
  createSharePublisher,
  linkedInAction,
  publishFor,
  type SharePublish,
  type SharePublishJob,
} from "../src/components/organization/org-chart-share-publish.ts";

const PAGE = "https://agents.gethouston.ai/o/AbCdEfGhIjKlMnOpQrSt_-";
const NEXT_PAGE = "https://agents.gethouston.ai/o/ZyXwVuTsRqPoNmLkJiHg_-";
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
  const states: SharePublish["status"][] = [];
  const sent: OrgChartShareInput[] = [];
  const reports: string[] = [];
  let last: SharePublish = { status: "idle" };
  const publisher = createSharePublisher(
    {
      publish: (input) => {
        sent.push(input);
        return answer(input) as Promise<OrgChartShareResult>;
      },
      report: (command) => reports.push(command),
      cardDeadlineMs,
    },
    (state) => {
      last = state;
      states.push(state.status);
    },
  );
  return { publisher, states, sent, reports, last: () => last };
}

const job = (image: File, card = async () => CARD): SharePublishJob => ({
  image,
  title: "Acme",
  card,
  deployment: { spaces: true },
});
const png = () =>
  new File(["png"], "acme-org-chart.png", { type: "image/png" });

describe("the share dialog's publish", () => {
  it("publishes nothing until asked, then the chart with its card, once per drawing", async () => {
    const h = harness(async () => PUBLISHED);
    const image = png();
    h.publisher.follow(image);
    h.publisher.end();
    deepStrictEqual(h.sent, []);
    h.publisher.start(job(image));
    h.publisher.start(job(image));
    await settle();
    deepStrictEqual(h.states, ["publishing", "ready"]);
    deepStrictEqual(h.last(), { status: "ready", image, pageUrl: PAGE });
    strictEqual(h.sent.length, 1);
    strictEqual(h.sent[0]?.image, image);
    strictEqual(h.sent[0]?.preview, CARD);
    deepStrictEqual(h.sent[0]?.deployment, { spaces: true });
    deepStrictEqual(h.reports, []);
  });

  it("keeps a published page across a reopening on the same drawing", async () => {
    const h = harness(async () => PUBLISHED);
    const image = png();
    h.publisher.start(job(image));
    await settle();
    h.publisher.end();
    h.publisher.follow(image);
    h.publisher.start(job(image));
    deepStrictEqual(h.last(), { status: "ready", image, pageUrl: PAGE });
    strictEqual(h.sent.length, 1);
  });

  it("aborts an upload under way when the dialog closes, and says nothing of it", async () => {
    const answer = deferred<OrgChartShareResult>();
    const h = harness(() => answer.promise);
    h.publisher.start(job(png()));
    await settle();
    const signal = h.sent[0]?.signal;
    h.publisher.end();
    strictEqual(signal?.aborted, true);
    answer.reject(new DOMException("closed", "AbortError"));
    await settle();
    deepStrictEqual(h.states, ["publishing", "idle"]);
    deepStrictEqual(h.reports, []);
  });

  it("drops the old drawing's page when the chart is redrawn while open, and publishes the new one on the next click", async () => {
    const pages = [PAGE, NEXT_PAGE];
    const h = harness(async () => ({ ...PUBLISHED, pageUrl: pages.shift() }));
    const before = png();
    h.publisher.start(job(before));
    await settle();
    h.publisher.follow(null);
    deepStrictEqual(h.last(), { status: "idle" });
    const after = png();
    h.publisher.follow(after);
    h.publisher.start(job(after));
    await settle();
    deepStrictEqual(h.last(), {
      status: "ready",
      image: after,
      pageUrl: NEXT_PAGE,
    });
    strictEqual(h.sent[1]?.image, after);
  });

  it("aborts the old drawing's upload when the chart is redrawn mid-publish", async () => {
    const answer = deferred<OrgChartShareResult>();
    const h = harness(() => answer.promise);
    h.publisher.start(job(png()));
    await settle();
    h.publisher.follow(png());
    strictEqual(h.sent[0]?.signal?.aborted, true);
    answer.resolve(PUBLISHED);
    await settle();
    deepStrictEqual(h.last(), { status: "idle" });
    deepStrictEqual(h.reports, []);
  });

  it("forgets a failure on close and on a redraw, so the next opening tries again", async () => {
    const h = harness(async () => ({ kind: "refused", code: "offline" }));
    const image = png();
    h.publisher.start(job(image));
    await settle();
    deepStrictEqual(h.last(), { status: "failed", image });
    h.publisher.start(job(image));
    strictEqual(h.sent.length, 1);
    h.publisher.end();
    deepStrictEqual(h.last(), { status: "idle" });
    h.publisher.start(job(image));
    await settle();
    strictEqual(h.sent.length, 2);
  });

  it("fails quietly on a refusal nothing in Houston caused", async () => {
    for (const code of [
      "unavailable",
      "offline",
      "timed_out",
      "account_deleted",
    ] as const) {
      const h = harness(async () => ({ kind: "refused", code }));
      h.publisher.start(job(png()));
      await settle();
      strictEqual(h.last().status, "failed");
      deepStrictEqual(h.reports, []);
    }
  });

  it("reports a refusal of what it drew, and a failure, once each", async () => {
    const refused = harness(async () => ({
      kind: "refused",
      code: "invalid_title",
    }));
    refused.publisher.start(job(png()));
    await settle();
    deepStrictEqual(refused.reports, ["org_chart_share_publish"]);
    const broken = harness(async () => {
      throw new Error("500");
    });
    broken.publisher.start(job(png()));
    await settle();
    strictEqual(broken.last().status, "failed");
    deepStrictEqual(broken.reports, ["org_chart_share_publish"]);
  });

  it("is ready with a page the gateway took without its card, and reports the card once", async () => {
    const h = harness(async () => ({
      ...PUBLISHED,
      previewRefused: "invalid_preview_size",
    }));
    h.publisher.start(job(png()));
    await settle();
    strictEqual(h.last().status, "ready");
    deepStrictEqual(h.reports, ["org_chart_share_card"]);
  });

  it("publishes the chart without its card when the card cannot be drawn", async () => {
    const h = harness(async () => PUBLISHED);
    h.publisher.start(
      job(png(), async () => {
        throw new Error("no canvas");
      }),
    );
    await settle();
    strictEqual(h.sent[0]?.preview, undefined);
    strictEqual(h.last().status, "ready");
    deepStrictEqual(h.reports, ["org_chart_share_card"]);
  });

  it("publishes without the card once it outlasts its deadline, and ignores it after", async () => {
    const card = deferred<Blob>();
    const h = harness(async () => PUBLISHED, 5);
    h.publisher.start(job(png(), () => card.promise));
    await settle(20);
    strictEqual(h.sent.length, 1);
    strictEqual(h.sent[0]?.preview, undefined);
    strictEqual(h.last().status, "ready");
    deepStrictEqual(h.reports, ["org_chart_share_card"]);
    card.reject(new Error("late"));
    await settle();
    deepStrictEqual(h.reports, ["org_chart_share_card"]);
  });

  it("sends nothing, and reports nothing, when the dialog closed while the card was drawing", async () => {
    const card = deferred<Blob>();
    const h = harness(async () => PUBLISHED);
    h.publisher.start(job(png(), () => card.promise));
    h.publisher.end();
    card.reject(new Error("canvas lost"));
    await settle();
    deepStrictEqual(h.sent, []);
    deepStrictEqual(h.states, ["publishing", "idle"]);
    deepStrictEqual(h.reports, []);
  });
});

describe("publishFor", () => {
  it("is idle for a publication about another drawing", () => {
    const image = png();
    const ready: SharePublish = { status: "ready", image, pageUrl: PAGE };
    deepStrictEqual(publishFor(ready, image), ready);
    deepStrictEqual(publishFor(ready, png()), { status: "idle" });
    deepStrictEqual(publishFor(ready, null), { status: "idle" });
  });
});

describe("linkedInAction", () => {
  const image = png();
  const ready: SharePublish = { status: "ready", image, pageUrl: PAGE };

  it("waits on the drawing, then publishes on the click, then waits on the page", () => {
    deepStrictEqual(linkedInAction("drawing", false, ready), {
      kind: "preparing",
    });
    deepStrictEqual(linkedInAction("ready", false, { status: "idle" }), {
      kind: "publish",
    });
    deepStrictEqual(
      linkedInAction("ready", false, { status: "publishing", image }),
      { kind: "preparing" },
    );
  });

  it("opens the page once it is ready, and falls back without one", () => {
    deepStrictEqual(linkedInAction("ready", false, ready), {
      kind: "link",
      pageUrl: PAGE,
    });
    deepStrictEqual(
      linkedInAction("ready", false, { status: "failed", image }),
      { kind: "fallback" },
    );
    deepStrictEqual(linkedInAction("failed", false, { status: "idle" }), {
      kind: "fallback",
    });
  });

  it("hands a drawn image to the phone's share sheet, publishing nothing", () => {
    deepStrictEqual(linkedInAction("ready", true, { status: "idle" }), {
      kind: "sheet",
    });
  });
});
