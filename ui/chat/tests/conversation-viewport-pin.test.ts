// Real-DOM mount of the conversation log, pinning what ConversationViewportPin
// adds to use-stick-to-bottom: a log held at its latest message stays there
// when its VIEWPORT resizes (a composer-slot card appearing or leaving), and a
// log the person scrolled up in is never moved.

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";
import {
  layout,
  maxScroll,
  mountLog,
  pinnedTop,
  resizeViewport,
  scrollTo,
  settle,
} from "./support/conversation-log-dom.ts";

const { createElement: h } = await import("react");
const { Conversation, ConversationContent } = await import(
  "../src/ai-elements/conversation.tsx"
);
const { ConversationViewportPin } = await import(
  "../src/ai-elements/conversation-viewport-pin.tsx"
);

const log = () =>
  mountLog(
    h(
      Conversation,
      null,
      h(ConversationViewportPin),
      h(ConversationContent, null, h("p", null, "latest line")),
    ),
  ).pane;

describe("ConversationViewportPin", () => {
  beforeEach(() => {
    layout.viewport = 400;
    layout.scrollTop = maxScroll();
  });

  it("keeps a pinned log on its latest line when the viewport shrinks", async () => {
    const pane = log();
    resizeViewport(pane, 250);
    await settle();
    assert.equal(layout.scrollTop, pinnedTop());
  });

  it("leaves a log the person scrolled up in where they put it", async () => {
    const pane = log();
    scrollTo(pane, maxScroll());
    scrollTo(pane, 100);
    await settle();
    resizeViewport(pane, 250);
    await settle();
    assert.equal(layout.scrollTop, 100);
  });

  it("does not read the clamp of a growing viewport as the person scrolling up", async () => {
    const pane = log();
    scrollTo(pane, maxScroll());
    await settle();
    // The browser clamps scrollTop down and reports it as a scroll.
    resizeViewport(pane, 550);
    scrollTo(pane, maxScroll());
    await settle();
    resizeViewport(pane, 300);
    await settle();
    assert.equal(layout.scrollTop, pinnedTop());
  });
});
