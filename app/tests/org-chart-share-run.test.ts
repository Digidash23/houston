import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  isExpectedClipboardRefusal,
  type ShareOutcome,
  type ShareRunDeps,
  shareLanding,
  shareOrgChart,
} from "../src/components/organization/org-chart-share-run.ts";

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

const PNG = new File(["png"], "acme-org-chart.png", { type: "image/png" });

/** Deps that record every call, desktop-shaped unless overridden. */
function harness(overrides: Partial<ShareRunDeps> = {}) {
  const calls: string[] = [];
  const reports: string[] = [];
  const deps: ShareRunDeps = {
    post: "Hello",
    png: Promise.resolve(PNG),
    ready: PNG,
    phone: false,
    sheet: undefined,
    copyImage: async () => {
      calls.push("copy");
    },
    open: async (url) => {
      calls.push(`open:${new URL(url).host}`);
      return true;
    },
    save: async (file) => {
      calls.push(`save:${file.name}`);
      return true;
    },
    report: (command) => reports.push(command),
    ...overrides,
  };
  return { deps, calls, reports };
}

describe("shareOrgChart on desktop", () => {
  it("starts the image copy, then opens LinkedIn, in the click's own tick", async () => {
    const drawing = deferred<File>();
    const copied = deferred<void>();
    const { deps, calls } = harness({ png: drawing.promise, ready: null });
    let handed: Promise<File> | null = null;
    deps.copyImage = (png) => {
      handed = png;
      calls.push("copy");
      return copied.promise;
    };
    const running = shareOrgChart(deps);
    // Synchronously, before the drawing or the copy settles: both started,
    // the copy first, and the copy was handed the drawing itself.
    deepStrictEqual(calls, ["copy", "open:www.linkedin.com"]);
    strictEqual(handed, drawing.promise);
    drawing.resolve(PNG);
    copied.resolve();
    const outcome = await running;
    deepStrictEqual(outcome.kind === "linkedin" && outcome.image, "copied");
    strictEqual(
      outcome.kind === "linkedin" &&
        new URL(outcome.url).searchParams.get("text"),
      "Hello",
    );
  });

  it("saves the image instead when the clipboard refuses, without a report", async () => {
    const { deps, calls, reports } = harness({
      copyImage: () =>
        Promise.reject(new DOMException("no focus", "NotAllowedError")),
    });
    const outcome = await shareOrgChart(deps);
    deepStrictEqual(calls, [
      "open:www.linkedin.com",
      "save:acme-org-chart.png",
    ]);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "saved");
    deepStrictEqual(reports, []);
  });

  it("saves the image where there is no image clipboard at all", async () => {
    const { deps, calls } = harness({ copyImage: undefined });
    const outcome = await shareOrgChart(deps);
    deepStrictEqual(calls, [
      "open:www.linkedin.com",
      "save:acme-org-chart.png",
    ]);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "saved");
  });

  it("reports an unexpected clipboard failure, and still saves", async () => {
    const { deps, reports } = harness({
      copyImage: () => {
        throw new TypeError("boom");
      },
    });
    const outcome = await shareOrgChart(deps);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "saved");
    deepStrictEqual(reports, ["org_chart_share_copy_image"]);
  });

  it("opens LinkedIn without the image when the drawing failed, reporting nothing new", async () => {
    const failed = Promise.reject(new Error("no canvas"));
    failed.catch(() => {});
    const { deps, calls, reports } = harness({
      png: failed,
      ready: null,
      copyImage: (png) => png.then(() => {}),
    });
    const outcome = await shareOrgChart(deps);
    deepStrictEqual(calls, ["open:www.linkedin.com"]);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "none");
    deepStrictEqual(reports, []);
  });

  it("says when the browser blocked the tab", async () => {
    const { deps } = harness({ open: async () => false });
    const outcome = await shareOrgChart(deps);
    strictEqual(outcome.kind === "linkedin" && outcome.opened, false);
  });

  it("reports a failed save", async () => {
    const { deps, reports } = harness({
      copyImage: undefined,
      save: () => Promise.reject(new Error("disk full")),
    });
    const outcome = await shareOrgChart(deps);
    strictEqual(outcome.kind === "linkedin" && outcome.image, "none");
    deepStrictEqual(reports, ["org_chart_share_download"]);
  });
});

describe("shareOrgChart on a phone", () => {
  const sheet = (share: () => Promise<void>, canShare = true) => ({
    canShare: () => canShare,
    share,
  });

  it("hands the image and the post to the share sheet, and nothing else", async () => {
    const shared: unknown[] = [];
    const { deps, calls } = harness({
      phone: true,
      sheet: sheet(async () => {}),
    });
    deps.sheet = {
      canShare: () => true,
      share: async (data) => {
        shared.push(data);
      },
    };
    deepStrictEqual(await shareOrgChart(deps), { kind: "native" });
    deepStrictEqual(shared, [{ files: [PNG], text: "Hello" }]);
    deepStrictEqual(calls, []);
  });

  it("treats closing the sheet as a cancel, silently", async () => {
    const { deps, reports } = harness({
      phone: true,
      sheet: sheet(() => Promise.reject(new DOMException("x", "AbortError"))),
    });
    deepStrictEqual(await shareOrgChart(deps), { kind: "cancelled" });
    deepStrictEqual(reports, []);
  });

  it("treats a second tap while the sheet is up as the first share running, silently", async () => {
    const { deps, reports } = harness({
      phone: true,
      sheet: sheet(() =>
        Promise.reject(new DOMException("busy", "InvalidStateError")),
      ),
    });
    deepStrictEqual(await shareOrgChart(deps), { kind: "cancelled" });
    deepStrictEqual(reports, []);
  });

  it("reports a sheet that failed for another reason", async () => {
    const { deps, reports } = harness({
      phone: true,
      sheet: sheet(() => Promise.reject(new Error("boom"))),
    });
    deepStrictEqual(await shareOrgChart(deps), { kind: "failed" });
    deepStrictEqual(reports, ["org_chart_share_native"]);
  });

  it("goes the LinkedIn way when the sheet cannot take files or the image is still drawing", async () => {
    for (const overrides of [
      { sheet: sheet(async () => {}, false) },
      { sheet: sheet(async () => {}), ready: null },
      { sheet: undefined },
    ]) {
      const { deps, calls } = harness({ phone: true, ...overrides });
      const outcome = await shareOrgChart(deps);
      strictEqual(outcome.kind, "linkedin");
      deepStrictEqual(calls, ["copy", "open:www.linkedin.com"]);
    }
  });

  it("never uses the sheet at desktop width", async () => {
    const { deps } = harness({ sheet: sheet(async () => {}) });
    strictEqual((await shareOrgChart(deps)).kind, "linkedin");
  });
});

describe("isExpectedClipboardRefusal", () => {
  it("is only the browser's NotAllowedError", () => {
    strictEqual(
      isExpectedClipboardRefusal(new DOMException("x", "NotAllowedError")),
      true,
    );
    strictEqual(isExpectedClipboardRefusal(new Error("boom")), false);
    strictEqual(isExpectedClipboardRefusal(null), false);
  });
});

describe("shareLanding", () => {
  const linkedIn = (
    opened: boolean,
    image: "copied" | "saved" | "none",
  ): ShareOutcome => ({ kind: "linkedin", url: "u", opened, image });

  it("tracks where the image went, and toasts it", () => {
    deepStrictEqual(shareLanding(linkedIn(true, "copied"), false), {
      channel: "linkedin",
      toast: "copied",
      blocked: null,
    });
    deepStrictEqual(shareLanding(linkedIn(true, "saved"), false), {
      channel: "linkedin_download",
      toast: "saved",
      blocked: null,
    });
  });

  it("never counts a share whose image failed as a copied one", () => {
    deepStrictEqual(shareLanding(linkedIn(true, "none"), false), {
      channel: "linkedin_text_only",
      toast: null,
      blocked: null,
    });
  });

  it("tracks a blocked tab only once the toast's Open LinkedIn is used", () => {
    deepStrictEqual(shareLanding(linkedIn(false, "copied"), false), {
      channel: null,
      toast: "copied",
      blocked: "linkedin",
    });
    deepStrictEqual(shareLanding(linkedIn(false, "none"), false), {
      channel: null,
      toast: "blocked",
      blocked: "linkedin_text_only",
    });
    // The desktop shell explained its own refusal.
    deepStrictEqual(shareLanding(linkedIn(false, "none"), true), {
      channel: null,
      toast: null,
      blocked: null,
    });
  });

  it("tracks the share sheet, and nothing for a cancel or a failure", () => {
    strictEqual(shareLanding({ kind: "native" }, false).channel, "native");
    for (const kind of ["cancelled", "failed"] as const)
      deepStrictEqual(shareLanding({ kind }, false), {
        channel: null,
        toast: null,
        blocked: null,
      });
  });
});
