import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  INITIAL_SHARE_DIALOG,
  type ShareDialogAction,
  type ShareLine,
  shareDialogReducer,
} from "../src/components/organization/org-chart-share-state.ts";

const COPIED: ShareLine = { line: "copied", blocked: null, url: "u" };
const run = (...actions: ShareDialogAction[]) =>
  actions.reduce(shareDialogReducer, INITIAL_SHARE_DIALOG);

describe("shareDialogReducer", () => {
  it("says where the image went for a share started in this opening", () => {
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

  it("flips Copied back after its moment", () => {
    strictEqual(run({ type: "copied" }, { type: "copiedDone" }).copied, false);
  });
});
