import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type {
  OrgChartShareInput,
  OrgChartShareResult,
} from "@houston/engine-adapter";
import {
  createSharePublisher,
  linkedInAction,
  type SharePublish,
  type SharePublishJob,
} from "../src/components/organization/org-chart-share-publish.ts";

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(answer: (input: OrgChartShareInput) => Promise<unknown>) {
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
  it("publishes the chart with its card once per opening, then is ready with the page", async () => {
    const h = harness(async () => PUBLISHED);
    const image = png();
    h.publisher.begin(1, job(image));
    h.publisher.begin(1, job(png()));
    await settle();
    deepStrictEqual(h.states, ["publishing", "ready"]);
    deepStrictEqual(h.last(), { status: "ready", pageUrl: PAGE });
    strictEqual(h.sent.length, 1);
    strictEqual(h.sent[0]?.image, image);
    strictEqual(h.sent[0]?.preview, CARD);
    deepStrictEqual(h.sent[0]?.deployment, { spaces: true });
    deepStrictEqual(h.reports, []);
  });

  it("aborts an upload under way when the dialog closes, and says nothing of it", async () => {
    const answer = deferred<OrgChartShareResult>();
    const h = harness(() => answer.promise);
    h.publisher.begin(1, job(png()));
    await settle();
    const signal = h.sent[0]?.signal;
    h.publisher.end();
    strictEqual(signal?.aborted, true);
    answer.reject(new DOMException("closed", "AbortError"));
    await settle();
    deepStrictEqual(h.states, ["publishing", "idle"]);
    deepStrictEqual(h.reports, []);
  });

  it("publishes again on the next opening, unless the drawing is the same one", async () => {
    const h = harness(async () => PUBLISHED);
    const image = png();
    h.publisher.begin(1, job(image));
    await settle();
    h.publisher.end();
    h.publisher.begin(2, job(image));
    deepStrictEqual(h.last(), { status: "ready", pageUrl: PAGE });
    strictEqual(h.sent.length, 1);
    h.publisher.end();
    h.publisher.begin(3, job(png()));
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
      h.publisher.begin(1, job(png()));
      await settle();
      deepStrictEqual(h.last(), { status: "failed" });
      deepStrictEqual(h.reports, []);
    }
  });

  it("reports a refusal of what it drew, and a failure, once each", async () => {
    const refused = harness(async () => ({
      kind: "refused",
      code: "invalid_title",
    }));
    refused.publisher.begin(1, job(png()));
    await settle();
    deepStrictEqual(refused.reports, ["org_chart_share_publish"]);
    const broken = harness(async () => {
      throw new Error("500");
    });
    broken.publisher.begin(1, job(png()));
    await settle();
    deepStrictEqual(broken.last(), { status: "failed" });
    deepStrictEqual(broken.reports, ["org_chart_share_publish"]);
  });

  it("publishes the chart without its card when the card cannot be drawn", async () => {
    const h = harness(async () => PUBLISHED);
    h.publisher.begin(
      1,
      job(png(), async () => {
        throw new Error("no canvas");
      }),
    );
    await settle();
    strictEqual(h.sent[0]?.preview, undefined);
    deepStrictEqual(h.last(), { status: "ready", pageUrl: PAGE });
    deepStrictEqual(h.reports, ["org_chart_share_card"]);
  });

  it("sends nothing when the dialog closed while the card was drawing", async () => {
    const card = deferred<Blob>();
    const h = harness(async () => PUBLISHED);
    h.publisher.begin(
      1,
      job(png(), () => card.promise),
    );
    h.publisher.end();
    card.resolve(CARD);
    await settle();
    deepStrictEqual(h.sent, []);
    deepStrictEqual(h.states, ["publishing", "idle"]);
  });
});

describe("linkedInAction", () => {
  const ready: SharePublish = { status: "ready", pageUrl: PAGE };

  it("waits on the drawing, then on the page", () => {
    deepStrictEqual(linkedInAction("drawing", false, ready), {
      kind: "preparing",
    });
    for (const status of ["idle", "publishing"] as const)
      deepStrictEqual(linkedInAction("ready", false, { status }), {
        kind: "preparing",
      });
  });

  it("posts the page once it is ready, and falls back without one", () => {
    deepStrictEqual(linkedInAction("ready", false, ready), {
      kind: "link",
      pageUrl: PAGE,
    });
    deepStrictEqual(linkedInAction("ready", false, { status: "failed" }), {
      kind: "fallback",
    });
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
