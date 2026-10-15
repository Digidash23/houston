import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  type HoldingDocument,
  reserveBrowserTab,
  type TabHandle,
} from "../src/lib/browser-tab.ts";

function fakeTab() {
  const log: string[] = [];
  const tab: TabHandle & { hrefs: string[]; document: HoldingDocument } = {
    closed: false,
    document: { title: "", body: { textContent: "", style: { cssText: "" } } },
    opener: { some: "window" },
    hrefs: [],
    location: {
      set href(value: string) {
        tab.hrefs.push(value);
      },
      get href() {
        return tab.hrefs.at(-1) ?? "";
      },
    },
    close: () => {
      log.push("close");
      tab.closed = true;
    },
  };
  return { tab, log };
}

describe("reserveBrowserTab", () => {
  it("does not claim an empty tab in the native shell", () => {
    const originalWindow = globalThis.window;
    globalThis.window = { __HOUSTON_SURFACE__: "ios" } as Window &
      typeof globalThis;
    try {
      const reserved = reserveBrowserTab(() => {
        throw new Error("native must not claim a web tab");
      });
      strictEqual(reserved !== null, true);
      reserved?.discard();
    } finally {
      if (originalWindow === undefined)
        Reflect.deleteProperty(globalThis, "window");
      else globalThis.window = originalWindow;
    }
  });
  it("claims the tab, disowns its opener, and navigates it later", () => {
    const { tab } = fakeTab();
    const reserved = reserveBrowserTab(() => tab);
    strictEqual(reserved !== null, true);
    // The provider page must never be able to reach back into Houston's tab.
    strictEqual(tab.opener, null);
    strictEqual(reserved?.navigate("https://oauth.example/slack"), true);
    deepStrictEqual(tab.hrefs, ["https://oauth.example/slack"]);
  });

  it("is null when the browser refuses even the synchronous open", () => {
    strictEqual(
      reserveBrowserTab(() => null),
      null,
    );
  });

  it("reports a tab the user closed while the link was minting", () => {
    const { tab } = fakeTab();
    const reserved = reserveBrowserTab(() => tab);
    tab.closed = true;
    strictEqual(reserved?.navigate("https://oauth.example/slack"), false);
    deepStrictEqual(tab.hrefs, [], "never navigates a closed tab");
  });

  it("discard closes an empty tab, never a navigated one", () => {
    const empty = fakeTab();
    reserveBrowserTab(() => empty.tab)?.discard();
    deepStrictEqual(empty.log, ["close"]);

    const used = fakeTab();
    const reserved = reserveBrowserTab(() => used.tab);
    reserved?.navigate("https://oauth.example/slack");
    reserved?.discard();
    deepStrictEqual(used.log, [], "the OAuth page stays open");
  });

  it("holds a line in the empty tab, and leaves a navigated or closed one alone", () => {
    const empty = fakeTab();
    reserveBrowserTab(() => empty.tab)?.hold("Preparing your post...");
    strictEqual(empty.tab.document.title, "Preparing your post...");
    strictEqual(empty.tab.document.body?.textContent, "Preparing your post...");
    strictEqual(
      empty.tab.document.body?.style.cssText.includes("Canvas"),
      true,
    );

    const used = fakeTab();
    const reserved = reserveBrowserTab(() => used.tab);
    reserved?.navigate("https://www.linkedin.com/feed/");
    reserved?.hold("late");
    strictEqual(used.tab.document.title, "");

    const closed = fakeTab();
    const gone = reserveBrowserTab(() => closed.tab);
    closed.tab.closed = true;
    gone?.hold("late");
    strictEqual(closed.tab.document.body?.textContent, "");
  });

  it("does nothing until it is asked: an OAuth tab stays blank", () => {
    const { tab } = fakeTab();
    reserveBrowserTab(() => tab)?.navigate("https://oauth.example/slack");
    strictEqual(tab.document.title, "");
    strictEqual(tab.document.body?.textContent, "");
  });
});
