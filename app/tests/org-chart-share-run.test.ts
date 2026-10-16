import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { isExpectedClipboardRefusal } from "../src/components/organization/org-chart-share-copy.ts";
import {
  NO_LANDING,
  openComposer,
  type ShareSheet,
  shareRoute,
  shareViaSheet,
} from "../src/components/organization/org-chart-share-run.ts";

const PNG = new File(["png"], "acme-org-chart.png", { type: "image/png" });
const URL_ = "https://www.linkedin.com/feed/?shareActive=true&text=x";

const sheet = (
  share: ShareSheet["share"] = async () => {},
  canShare = true,
): ShareSheet => ({ canShare: () => canShare, share });

describe("shareRoute", () => {
  const env = {
    tauri: false,
    native: false,
    coarse: true,
    sheet: sheet(),
    image: PNG,
  };

  it("takes the share sheet only on a touch device whose sheet takes the picture", () => {
    strictEqual(shareRoute(env).kind, "sheet");
    strictEqual(shareRoute({ ...env, coarse: false }).kind, "tab");
  });

  it("claims no tab on a touch device whose sheet cannot take the picture", () => {
    // iPad Safari suspends the Houston tab once a claimed tab takes focus.
    for (const overrides of [
      { sheet: undefined },
      { sheet: sheet(async () => {}, false) },
      { image: null },
    ])
      strictEqual(shareRoute({ ...env, ...overrides }).kind, "plain");
  });

  it("claims no tab in the mobile app, whose browser opens after an await", () => {
    strictEqual(
      shareRoute({ ...env, native: true, coarse: false, sheet: undefined })
        .kind,
      "plain",
    );
  });

  it("is the desktop app's own way in the desktop app", () => {
    strictEqual(shareRoute({ ...env, tauri: true }).kind, "shell");
  });
});

describe("shareViaSheet", () => {
  const run = (share: ShareSheet["share"]) => {
    const reports: string[] = [];
    const landing = shareViaSheet(sheet(share), PNG, "post", (command) =>
      reports.push(command),
    );
    return { landing, reports };
  };

  it("tracks the share sheet", async () => {
    strictEqual((await run(async () => {}).landing).channel, "native");
  });

  it("treats closing the sheet, or a second tap while it is up, as quiet", async () => {
    for (const name of ["AbortError", "InvalidStateError"]) {
      const { landing, reports } = run(() =>
        Promise.reject(new DOMException("x", name)),
      );
      deepStrictEqual(await landing, NO_LANDING);
      deepStrictEqual(reports, []);
    }
  });

  it("reports a sheet that failed for another reason", async () => {
    const { landing, reports } = run(() => Promise.reject(new Error("boom")));
    deepStrictEqual(await landing, NO_LANDING);
    deepStrictEqual(reports, ["org_chart_share_native"]);
  });
});

describe("openComposer", () => {
  const share = { channel: "linkedin_link", notAttached: false } as const;

  it("offers LinkedIn's link when a browser blocked the open", async () => {
    deepStrictEqual(
      await openComposer("tab", null, async () => false, URL_, share),
      {
        channel: null,
        notAttached: false,
        blocked: { url: URL_, channel: "linkedin_link" },
      },
    );
  });

  it("offers LinkedIn's link when the mobile app's browser refused the open", async () => {
    strictEqual(
      (await openComposer("plain", null, async () => false, URL_, share))
        .blocked?.url,
      URL_,
    );
  });

  it("leaves a refusal in the desktop app to the shell's own toast", async () => {
    deepStrictEqual(
      await openComposer("shell", null, async () => false, URL_, {
        channel: "linkedin_text_only",
        notAttached: true,
      }),
      { ...NO_LANDING, notAttached: true },
    );
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
