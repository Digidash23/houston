import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  createLinkedInShare,
  type LinkedInClick,
  type LinkedInShareDeps,
} from "../src/components/organization/org-chart-share-linkedin.ts";
import type { SharePublishJob } from "../src/components/organization/org-chart-share-publish-page.ts";
import {
  type ShareRoute,
  shareRoute,
} from "../src/components/organization/org-chart-share-run.ts";
import type { ReservedTab } from "../src/lib/browser-tab.ts";

const PAGE = "https://agents.gethouston.ai/o/AbCdEfGhIjKlMnOpQrSt_-";
const HOLDING = "Preparing your LinkedIn post...";

/** A promise this test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const png = () =>
  new File(["png"], "acme-org-chart.png", { type: "image/png" });
const textOf = (url: string) =>
  new URL(url).searchParams.get("text") ?? "<no text>";

/** A claimed tab that records what is done to it. */
function fakeTab(log: string[]) {
  let closed = false;
  const tab: ReservedTab & { close: () => void } = {
    hold: (line) => log.push(`hold:${line}`),
    navigate: (url) => {
      if (closed) return false;
      log.push(`navigate:${textOf(url)}`);
      return true;
    },
    discard: () => log.push("discard"),
    close: () => {
      closed = true;
    },
  };
  return tab;
}

/** Deps that record every call; each publish waits for the test's answer. */
function harness(overrides: Partial<LinkedInShareDeps> = {}) {
  const log: string[] = [];
  const pages: ReturnType<typeof deferred<string | null>>[] = [];
  const signals: AbortSignal[] = [];
  const tab = fakeTab(log);
  const share = createLinkedInShare(
    {
      publish: (_job, signal) => {
        log.push("publish");
        signals.push(signal);
        const page = deferred<string | null>();
        pages.push(page);
        signal.addEventListener("abort", () => page.resolve(null));
        return page.promise;
      },
      open: async (url) => {
        log.push(`open:${textOf(url)}`);
        return true;
      },
      reserve: () => {
        log.push("reserve");
        return tab;
      },
      report: (command) => log.push(`report:${command}`),
      ...overrides,
    },
    () => {},
  );
  return { share, log, pages, signals, tab };
}

const TAB: ShareRoute = { kind: "tab" };
function click(image: File | null, route: ShareRoute = TAB): LinkedInClick {
  return {
    route,
    drawing: image ? { status: "ready", image } : { status: "drawing" },
    post: (link) => `Hello ${link}`,
    holding: HOLDING,
    job: (img): SharePublishJob => ({
      image: img,
      title: "Acme",
      card: async () => new Blob(["card"]),
      deployment: { spaces: true },
    }),
  };
}

describe("Share on LinkedIn in a browser, in one click", () => {
  it("claims a tab inside the click, holds the line in it, then points it at the page's post", async () => {
    const h = harness();
    const landing = h.share.click(click(png()));
    // Synchronously, inside the click: the tab first, then the upload.
    deepStrictEqual(h.log, ["reserve", `hold:${HOLDING}`, "publish"]);
    strictEqual(h.share.state().publishing !== null, true);
    h.pages[0]?.resolve(PAGE);
    deepStrictEqual(await landing, {
      channel: "linkedin_link",
      notAttached: false,
      blocked: null,
    });
    strictEqual(h.log.at(-1), `navigate:Hello ${PAGE}`);
    strictEqual(h.share.state().publishing, null);
  });

  it("ignores clicks while the page goes up", async () => {
    const h = harness();
    const image = png();
    const first = h.share.click(click(image));
    strictEqual(h.share.click(click(image)), null);
    strictEqual(h.share.click(click(null)), null);
    h.pages[0]?.resolve(PAGE);
    await first;
    strictEqual(h.log.filter((l) => l === "publish").length, 1);
  });

  it("opens an already published drawing at once, with no tab claimed first", async () => {
    const h = harness();
    const image = png();
    const first = h.share.click(click(image));
    h.pages[0]?.resolve(PAGE);
    await first;
    h.log.length = 0;
    const again = h.share.click(click(image));
    // The open started inside the click: nothing claimed, nothing published.
    deepStrictEqual(h.log, [`open:Hello ${PAGE}`]);
    strictEqual((await again)?.channel, "linkedin_link");
  });

  it("posts without the page when publishing fails, and says the picture was not attached", async () => {
    const h = harness();
    const landing = h.share.click(click(png()));
    h.pages[0]?.resolve(null);
    deepStrictEqual(await landing, {
      channel: "linkedin_text_only",
      notAttached: true,
      blocked: null,
    });
    strictEqual(h.log.at(-1), "navigate:Hello gethouston.ai");
  });

  it("gives up on a slow page at its patience, aborting the upload and reporting it once", async () => {
    const h = harness({ patienceMs: 5 });
    const landing = h.share.click(click(png()));
    await settle(20);
    strictEqual(h.signals[0]?.aborted, true);
    strictEqual(h.signals[0]?.reason?.name, "TimeoutError");
    strictEqual((await landing)?.notAttached, true);
    strictEqual(h.log.at(-1), "navigate:Hello gethouston.ai");
    deepStrictEqual(
      h.log.filter((l) => l.startsWith("report")),
      ["report:org_chart_share_publish"],
    );
  });

  it("reports nothing when the dialog closes or the chart is redrawn mid-publish", async () => {
    // A publish deaf to its abort keeps going past the patience.
    const h = harness({
      patienceMs: 5,
      publish: () => new Promise<string | null>(() => {}),
    });
    h.share.click(click(png()));
    h.share.end();
    const image = png();
    h.share.follow(image);
    h.share.click(click(image));
    h.share.follow(png());
    await settle(20);
    ok(!h.log.some((l) => l.startsWith("report")));
  });

  it("closes the tab and reports once when pointing it at LinkedIn throws", async () => {
    const h = harness();
    h.tab.navigate = () => {
      throw new DOMException("cross-origin", "SecurityError");
    };
    const landing = h.share.click(click(png()));
    h.pages[0]?.resolve(PAGE);
    deepStrictEqual(await landing, {
      channel: null,
      notAttached: false,
      blocked: null,
    });
    deepStrictEqual(h.log.slice(-2), ["discard", "report:org_chart_share"]);
    strictEqual(h.share.state().publishing, null);
  });

  it("frees the button and closes the tab when the publish rejects", async () => {
    const h = harness({
      patienceMs: 5,
      publish: () => Promise.reject(new Error("reporter threw")),
    });
    const landing = h.share.click(click(png()));
    strictEqual((await landing)?.channel, null);
    deepStrictEqual(h.log.slice(-2), ["discard", "report:org_chart_share"]);
    strictEqual(h.share.state().publishing, null);
    await settle(20);
    // The patience timer died with the click: no timeout report.
    strictEqual(h.log.filter((l) => l.startsWith("report")).length, 1);
    // And the button takes the next click.
    ok(h.share.click(click(png())) !== null);
  });

  it("aborts the upload and closes the tab when the dialog closes mid-publish", async () => {
    const h = harness();
    const landing = h.share.click(click(png()));
    h.share.end();
    strictEqual(h.signals[0]?.aborted, true);
    deepStrictEqual(await landing, {
      channel: null,
      notAttached: false,
      blocked: null,
    });
    strictEqual(h.log.at(-1), "discard");
    ok(!h.log.some((l) => l.startsWith("navigate")));
    strictEqual(h.share.state().publishing, null);
  });

  it("drops the old drawing's page, and aborts its upload, when the chart is redrawn", async () => {
    const h = harness();
    const before = png();
    const first = h.share.click(click(before));
    h.pages[0]?.resolve(PAGE);
    await first;
    h.share.follow(png());
    strictEqual(h.share.state().page, null);
    const after = png();
    h.share.follow(after);
    h.share.click(click(after));
    h.share.follow(png());
    strictEqual(h.signals[1]?.aborted, true);
    strictEqual(h.log.at(-1), "discard");
  });

  it("opens plainly after the upload when the browser refused the tab, and links to LinkedIn when it blocks that too", async () => {
    const h = harness({ reserve: () => null, open: async () => false });
    const landing = h.share.click(click(png()));
    h.pages[0]?.resolve(PAGE);
    const { blocked, channel } = (await landing) ?? {};
    strictEqual(channel, null);
    strictEqual(blocked?.channel, "linkedin_link");
    strictEqual(textOf(blocked?.url ?? ""), `Hello ${PAGE}`);
  });

  it("says nothing when the person closed the tab while the page went up, and keeps the page", async () => {
    const h = harness();
    const image = png();
    const landing = h.share.click(click(image));
    h.tab.close();
    h.pages[0]?.resolve(PAGE);
    strictEqual((await landing)?.channel, null);
    strictEqual(h.share.state().page?.pageUrl, PAGE);
  });

  it("reports a holding line it could not write, and shares on", async () => {
    const h = harness();
    h.tab.hold = () => {
      throw new Error("no document");
    };
    const landing = h.share.click(click(png()));
    h.pages[0]?.resolve(PAGE);
    strictEqual((await landing)?.channel, "linkedin_link");
    ok(h.log.includes("report:org_chart_share_holding"));
  });
});

describe("Share on LinkedIn with no tab to claim", () => {
  const PLAIN: ShareRoute = { kind: "plain" };

  it("publishes, then opens LinkedIn plainly, never claiming a tab", async () => {
    const h = harness();
    const landing = h.share.click(click(png(), PLAIN));
    deepStrictEqual(h.log, ["publish"]);
    h.pages[0]?.resolve(PAGE);
    strictEqual((await landing)?.channel, "linkedin_link");
    deepStrictEqual(h.log, ["publish", `open:Hello ${PAGE}`]);
  });

  it("links to LinkedIn in the dialog when the open is refused", async () => {
    const h = harness({ open: async () => false });
    const landing = h.share.click(click(png(), PLAIN));
    h.pages[0]?.resolve(PAGE);
    const { blocked, channel } = (await landing) ?? {};
    strictEqual(channel, null);
    strictEqual(textOf(blocked?.url ?? ""), `Hello ${PAGE}`);
  });
});

describe("Share on LinkedIn in the desktop app", () => {
  it("publishes, then opens the browser, with no tab to claim", async () => {
    const h = harness();
    const landing = h.share.click(click(png(), { kind: "shell" }));
    deepStrictEqual(h.log, ["publish"]);
    h.pages[0]?.resolve(PAGE);
    strictEqual((await landing)?.channel, "linkedin_link");
    deepStrictEqual(h.log, ["publish", `open:Hello ${PAGE}`]);
  });

  it("opens the post without the page when the host keeps no shared pictures", async () => {
    const h = harness();
    const landing = h.share.click(click(png(), { kind: "shell" }));
    h.pages[0]?.resolve(null);
    strictEqual((await landing)?.notAttached, true);
    strictEqual(h.log.at(-1), "open:Hello gethouston.ai");
  });
});

describe("Share on LinkedIn on a touch device", () => {
  it("hands the picture and the post to the share sheet, and never publishes", async () => {
    const image = png();
    const shared: unknown[] = [];
    const sheet = {
      canShare: () => true,
      share: async (data: unknown) => {
        shared.push(data);
      },
    };
    const route = shareRoute({
      tauri: false,
      native: false,
      coarse: true,
      sheet,
      image,
    });
    strictEqual(route.kind, "sheet");
    const h = harness();
    strictEqual((await h.share.click(click(image, route)))?.channel, "native");
    deepStrictEqual(shared, [{ files: [image], text: "Hello gethouston.ai" }]);
    deepStrictEqual(h.log, []);
  });
});

describe("Share on LinkedIn without a picture", () => {
  it("opens the post alone when the drawing failed", async () => {
    const h = harness();
    const landing = h.share.click({
      ...click(null),
      drawing: { status: "failed" },
    });
    strictEqual((await landing)?.channel, "linkedin_text_only");
    deepStrictEqual(h.log, ["open:Hello gethouston.ai"]);
  });
});
