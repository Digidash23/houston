// After Post: the post this opening made opens in the browser once, and the
// dialog says so; a post replayed into another opening never opens. Plus how
// loudly the primary button asks at each step.

import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  type OwnPostPorts,
  openOwnPost,
} from "../src/components/organization/linkedin-post-open.ts";
import { shareLineKey } from "../src/components/organization/org-chart-share-line-copy.ts";
import type { ShareLine } from "../src/components/organization/org-chart-share-run.ts";
import {
  INITIAL_SHARE_DIALOG,
  type ShareDialogAction,
  type ShareDialogState,
  shareDialogReducer,
} from "../src/components/organization/org-chart-share-state.ts";
import {
  primaryVariant,
  type ShareStep,
  shareStep,
} from "../src/components/organization/org-chart-share-step.ts";
import en from "../src/locales/en/teams.json" with { type: "json" };

const POST_URL = "https://www.linkedin.com/feed/update/urn:li:share:7/";
const connected = {
  status: "ready",
  connection: {
    connected: true,
    name: "Ada",
    expiresAt: "2026-12-01T00:00:00Z",
  },
} as const;

/** The dialog as the hooks drive it: one reducer, opened once. */
function dialog() {
  let state = shareDialogReducer(INITIAL_SHARE_DIALOG, { type: "open" });
  const dispatch = (action: ShareDialogAction) => {
    state = shareDialogReducer(state, action);
  };
  return {
    get state(): ShareDialogState {
      return state;
    },
    dispatch,
  };
}

/** A browser that takes (or refuses) every URL, recording each one. */
function browser(
  dialogOn: ReturnType<typeof dialog>,
  takes = true,
): OwnPostPorts & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    onScreen: () => (dialogOn.state.open ? dialogOn.state.session : null),
    open: async (url) => {
      opened.push(url);
      return takes;
    },
    dispatch: dialogOn.dispatch,
  };
}

const stepOf = (state: ShareDialogState) =>
  shareStep({
    route: "post",
    connection: connected,
    connecting: "idle",
    posting: false,
    posted: state.posted,
  });

const words = (line: ShareLine | null) => {
  if (line?.kind !== "posted") return null;
  const key = shareLineKey(line).replace("orgChart.share.", "");
  return en.orgChart.share[key as "posted" | "postedOpened"];
};

describe("the post this opening made", () => {
  it("opens once, and View post steps back with the line saying so", async () => {
    const d = dialog();
    const made = d.state.session;
    const ports = browser(d);
    d.dispatch({ type: "posting" });
    d.dispatch({ type: "posted", postUrl: POST_URL });
    await openOwnPost(POST_URL, made, ports);
    // The slot's landing may come again after the open: it stays opened.
    d.dispatch({ type: "posted", postUrl: POST_URL });

    deepStrictEqual(ports.opened, [POST_URL]);
    deepStrictEqual(stepOf(d.state), {
      kind: "posted",
      postUrl: POST_URL,
      opened: true,
    });
    strictEqual(primaryVariant(stepOf(d.state)), "outline");
    strictEqual(
      words(d.state.line),
      "Posted to LinkedIn. It's open in your browser.",
    );
  });

  it("keeps View post leading when the browser refused the open", async () => {
    const d = dialog();
    const ports = browser(d, false);
    d.dispatch({ type: "posted", postUrl: POST_URL });
    await openOwnPost(POST_URL, d.state.session, ports);

    deepStrictEqual(ports.opened, [POST_URL]);
    strictEqual(primaryVariant(stepOf(d.state)), "default");
    strictEqual(words(d.state.line), "Posted to LinkedIn.");
  });

  it("opens nothing once the dialog closed before it went up", async () => {
    const d = dialog();
    const made = d.state.session;
    const ports = browser(d);
    d.dispatch({ type: "close" });
    await openOwnPost(POST_URL, made, ports);

    deepStrictEqual(ports.opened, []);
  });

  it("drops the opened line when the dialog closed while the browser opened", async () => {
    const d = dialog();
    const made = d.state.session;
    let take = (_: boolean) => {};
    const ports: OwnPostPorts = {
      ...browser(d),
      open: () =>
        new Promise((resolve) => {
          take = resolve;
        }),
    };
    d.dispatch({ type: "posted", postUrl: POST_URL });
    const opening = openOwnPost(POST_URL, made, ports);
    d.dispatch({ type: "close" });
    d.dispatch({ type: "open" });
    take(true);
    await opening;

    strictEqual(d.state.posted, null);
    strictEqual(d.state.line, null);
  });
});

describe("a post replayed into another opening", () => {
  it("is shown without opening, View post leading", async () => {
    const d = dialog();
    const earlier = d.state.session;
    d.dispatch({ type: "close" });
    d.dispatch({ type: "open" });
    const ports = browser(d);
    // The remounted dialog reads the slot's landing; the earlier opening's
    // Post settles meanwhile.
    d.dispatch({ type: "posted", postUrl: POST_URL });
    await openOwnPost(POST_URL, earlier, ports);

    deepStrictEqual(ports.opened, []);
    deepStrictEqual(d.state.posted, { postUrl: POST_URL, opened: false });
    strictEqual(primaryVariant(stepOf(d.state)), "default");
    strictEqual(words(d.state.line), "Posted to LinkedIn.");
  });
});

describe("how loudly the primary button asks", () => {
  const cases: [ShareStep, "default" | "outline"][] = [
    [{ kind: "share", via: "sheet" }, "default"],
    [{ kind: "share", via: "paste" }, "default"],
    [{ kind: "checking" }, "default"],
    [{ kind: "connect", phase: "idle" }, "outline"],
    [{ kind: "connect", phase: "minting" }, "outline"],
    [{ kind: "connect", phase: "waiting" }, "outline"],
    [{ kind: "post", name: "Ada", posting: false }, "default"],
    [{ kind: "post", name: "Ada", posting: true }, "default"],
    [{ kind: "posted", postUrl: POST_URL, opened: false }, "default"],
    [{ kind: "posted", postUrl: POST_URL, opened: true }, "outline"],
  ];
  for (const [step, variant] of cases)
    it(`${JSON.stringify(step)} is ${variant}`, () => {
      strictEqual(primaryVariant(step), variant);
    });
});
