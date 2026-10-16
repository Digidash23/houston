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

  it("ties a connect to its opening and attempt, dropping stale results", () => {
    const watch = { until: 600_000 };
    const open = run({ type: "open" });
    const tag = { session: open.session, attempt: 1 };
    const minting = shareDialogReducer(open, {
      type: "connecting",
      ...tag,
      watch,
    });
    deepStrictEqual(minting.connect, { id: 1, minting: true, watch });
    const waiting = shareDialogReducer(minting, {
      type: "connectOpened",
      ...tag,
    });
    strictEqual(waiting.connect?.minting, false);
    // Started over: attempt 2 replaces 1, whose late results change nothing.
    const restarted = shareDialogReducer(waiting, {
      type: "connecting",
      session: open.session,
      attempt: 2,
      watch,
    });
    strictEqual(
      shareDialogReducer(restarted, { type: "connectEnded", ...tag }),
      restarted,
    );
    strictEqual(
      shareDialogReducer(restarted, { type: "connectOpened", ...tag }),
      restarted,
    );
    strictEqual(
      shareDialogReducer(restarted, {
        type: "connectEnded",
        session: open.session,
        attempt: 2,
      }).connect,
      null,
    );
  });

  it("drops a connect from an earlier opening, and ends it on close", () => {
    const watch = { until: 600_000 };
    const first = run(
      { type: "open" },
      {
        type: "connecting",
        session: 1,
        attempt: 1,
        watch,
      },
    );
    strictEqual(shareDialogReducer(first, { type: "close" }).connect, null);
    const reopened = run(
      { type: "open" },
      { type: "connecting", session: 1, attempt: 1, watch },
      { type: "close" },
      { type: "open" },
      { type: "connecting", session: 2, attempt: 2, watch },
    );
    const stale = shareDialogReducer(reopened, {
      type: "connectEnded",
      session: 1,
      attempt: 1,
      line: { kind: "blocked", url: "https://x.test", channel: null },
    });
    strictEqual(stale, reopened);
    // A connect started after the dialog closed lands nowhere.
    const closed = run({ type: "open" }, { type: "close" });
    strictEqual(
      shareDialogReducer(closed, {
        type: "connecting",
        session: 1,
        attempt: 3,
        watch,
      }).connect,
      null,
    );
  });

  it("keeps a post going across a reopen, and lands it in the opening on screen", () => {
    const url = "https://www.linkedin.com/feed/update/urn:li:share:7/";
    const posting = run({ type: "open" }, { type: "posting" });
    strictEqual(posting.posting, true);
    // Closed and reopened while the post is out: still Posting, never Post.
    const reopened = run(
      { type: "open" },
      { type: "posting" },
      { type: "close" },
      { type: "open" },
    );
    strictEqual(reopened.posting, true);
    const posted = shareDialogReducer(reopened, {
      type: "posted",
      postUrl: url,
    });
    strictEqual(posted.posting, false);
    strictEqual(posted.postUrl, url);
    deepStrictEqual(posted.line, { kind: "posted" });
  });

  it("says a post went up while the dialog was closed on the next opening", () => {
    const url = "https://www.linkedin.com/feed/update/urn:li:share:7/";
    const closed = run(
      { type: "open" },
      { type: "posting" },
      { type: "close" },
      { type: "posted", postUrl: url },
    );
    strictEqual(closed.posting, false);
    const next = shareDialogReducer(closed, { type: "open" });
    strictEqual(next.postUrl, url);
    deepStrictEqual(next.line, { kind: "posted" });
    // Said once: the opening after that starts fresh.
    const after = [{ type: "close" }, { type: "open" }] as const;
    strictEqual(after.reduce(shareDialogReducer, next).postUrl, null);
  });

  it("says why a post was refused, in whichever opening is on screen", () => {
    const refused = run(
      { type: "open" },
      { type: "posting" },
      { type: "close" },
      { type: "open" },
      { type: "postRefused", line: { kind: "reconnect" } },
    );
    strictEqual(refused.posting, false);
    deepStrictEqual(refused.line, { kind: "reconnect" });
    strictEqual(refused.postUrl, null);
  });
});
