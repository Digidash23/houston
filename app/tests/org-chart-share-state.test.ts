import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { ShareLine } from "../src/components/organization/org-chart-share-run.ts";
import {
  INITIAL_SHARE_DIALOG,
  replacesShownImage,
  type ShareDialogAction,
  shareDialogReducer,
} from "../src/components/organization/org-chart-share-state.ts";

const COPIED: ShareLine = { kind: "copied" };
const run = (...actions: ShareDialogAction[]) =>
  actions.reduce(shareDialogReducer, INITIAL_SHARE_DIALOG);

describe("shareDialogReducer", () => {
  it("says where the picture went for a share started in this opening", () => {
    const open = run({ type: "open" });
    const landed = shareDialogReducer(open, {
      type: "landed",
      session: open.session,
      line: COPIED,
    });
    deepStrictEqual(landed.line, COPIED);
  });

  it("drops a share's line once the dialog was closed and opened again", () => {
    const first = run({ type: "open" });
    const reopened = run({ type: "open" }, { type: "close" }, { type: "open" });
    const landed = shareDialogReducer(reopened, {
      type: "landed",
      session: first.session,
      line: COPIED,
    });
    strictEqual(landed.line, null);
  });

  it("starts each opening with no line and Copy image unflipped", () => {
    const busy = run(
      { type: "open" },
      { type: "landed", session: 1, line: COPIED },
      { type: "copied" },
    );
    strictEqual(busy.copied, true);
    const reopened = run(
      { type: "open" },
      { type: "landed", session: 1, line: COPIED },
      { type: "copied" },
      { type: "close" },
      { type: "open" },
    );
    strictEqual(reopened.line, null);
    strictEqual(reopened.copied, false);
    strictEqual(reopened.open, true);
  });

  it("forgets the line and the Copied flip when the image is redrawn", () => {
    const redrawn = run(
      { type: "open" },
      { type: "landed", session: 1, line: COPIED },
      { type: "copied" },
      { type: "redrawn", url: "blob:new" },
    );
    strictEqual(redrawn.line, null);
    strictEqual(redrawn.copied, false);
    strictEqual(redrawn.open, true);
  });

  it("treats only a replaced picture as a redraw, not the first image", () => {
    strictEqual(replacesShownImage(null, "blob:first"), false);
    strictEqual(replacesShownImage("blob:a", "blob:a"), false);
    strictEqual(replacesShownImage("blob:a", null), true);
    strictEqual(replacesShownImage("blob:a", "blob:b"), true);
  });

  it("flips Copied back after its moment", () => {
    strictEqual(run({ type: "copied" }, { type: "copiedDone" }).copied, false);
  });

  it("keeps the person's words until the next opening", () => {
    const edited = run({ type: "open" }, { type: "edited", text: "Mine" });
    strictEqual(edited.text, "Mine");
    strictEqual(
      shareDialogReducer(edited, { type: "redrawn", url: null }).text,
      "Mine",
    );
    strictEqual(
      run(
        { type: "open" },
        { type: "edited", text: "x" },
        { type: "close" },
        { type: "open" },
      ).text,
      null,
    );
  });

  it("watches a connect until it ends or the dialog closes", () => {
    const watch = { until: 600_000 };
    const connecting = run({ type: "open" }, { type: "connecting", watch });
    deepStrictEqual(connecting.watch, watch);
    strictEqual(
      shareDialogReducer(connecting, { type: "watchEnded" }).watch,
      null,
    );
    strictEqual(shareDialogReducer(connecting, { type: "close" }).watch, null);
  });

  it("lands a post in the opening it started in, and never in a later one", () => {
    const posting = run({ type: "open" }, { type: "posting" });
    strictEqual(posting.posting, true);
    const url = "https://www.linkedin.com/feed/update/urn:li:share:7/";
    const posted = shareDialogReducer(posting, {
      type: "posted",
      session: posting.session,
      postUrl: url,
    });
    strictEqual(posted.postUrl, url);
    strictEqual(posted.posting, false);
    deepStrictEqual(posted.line, { kind: "posted" });
    const later = run(
      { type: "open" },
      { type: "posting" },
      { type: "close" },
      { type: "open" },
    );
    strictEqual(
      shareDialogReducer(later, { type: "posted", session: 1, postUrl: url })
        .postUrl,
      null,
    );
  });

  it("says why a post was refused, and lets the person try again", () => {
    const posting = run({ type: "open" }, { type: "posting" });
    const refused = shareDialogReducer(posting, {
      type: "postRefused",
      session: posting.session,
      line: { kind: "reconnect" },
    });
    strictEqual(refused.posting, false);
    deepStrictEqual(refused.line, { kind: "reconnect" });
    strictEqual(refused.postUrl, null);
  });
});
