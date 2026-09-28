import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { TooltipProvider } from "@houston-ai/core";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppSidebar } from "../src/sidebar";

Object.assign(globalThis, { React });
const h = React.createElement;
const SEARCH = h("button", { type: "button", "aria-label": "Search" });

function render(
  windowControlsInset?: boolean,
  collapsed = false,
  headerActions?: React.ReactNode,
) {
  return renderToStaticMarkup(
    h(
      TooltipProvider,
      null,
      h(AppSidebar, {
        windowControlsInset,
        collapsed,
        headerActions,
        items: [],
        onSelect: () => undefined,
        onToggleCollapsed: () => undefined,
      }),
    ),
  );
}

describe("sidebar window controls inset", () => {
  it("defaults to the no-inset top line: toggle first, actions at the end", () => {
    const markup = render(false, false, SEARCH);
    assert.equal(render(undefined, false, SEARCH), markup);
    assert.ok(!markup.includes("data-window-controls-row"));
    assert.match(
      markup,
      /<div class="flex shrink-0 items-center gap-0.5 px-2 pt-3 pb-1"><button[^>]*aria-label="Collapse sidebar"[\s\S]*?<div class="min-w-0 flex-1"><\/div><button type="button" aria-label="Search">/,
    );
    const collapsed = render(false, true);
    assert.ok(collapsed.includes("w-[56px]"));
    assert.match(
      collapsed,
      /class="flex justify-center pt-3 pb-1"><button[^>]*aria-label="Expand sidebar"/,
    );
    assert.equal(collapsed.match(/aria-label="Expand sidebar"/g)?.length, 1);
    assert.ok(!collapsed.includes("cursor-pointer"));
    assert.ok(!collapsed.includes('<aside data-tour-target="sidebar" onClick'));
  });

  it("puts the reserved zone and toggle first on the inset line", () => {
    const markup = render(true);
    assert.ok(markup.includes("w-[272px]"));
    assert.match(markup, /data-window-controls-row="true" class="[^"]*h-10/);
    assert.match(
      markup,
      /data-tauri-drag-region="true" class="h-full shrink-0 w-\[84px\]"><\/div><button[^>]*aria-label="Collapse sidebar"/,
    );
    assert.ok(markup.includes("transition-[width]"));
  });

  it("widens the collapsed rail and leaves its controls row empty", () => {
    const markup = render(true, true);
    assert.ok(markup.includes("w-[84px]"));
    assert.ok(!markup.includes('aria-label="Collapse sidebar"'));
    assert.match(
      markup,
      /data-window-controls-row="true" class="[^"]*h-10"><\/div><div data-tauri-drag-region="true" class="flex justify-center pt-3 pb-1"><button[^>]*aria-label="Expand sidebar"/,
    );
    assert.ok(!markup.includes("cursor-pointer"));
  });
});

describe("sidebar header actions", () => {
  it("closes the inset top line, after the toggle and a drag spacer", () => {
    const markup = render(true, false, SEARCH);
    assert.match(
      markup,
      /aria-label="Collapse sidebar".*<div data-tauri-drag-region="true" class="h-full min-w-0 flex-1"><\/div><div class="flex shrink-0 items-center gap-0.5 pr-2"><button type="button" aria-label="Search">/,
    );
  });

  it("stacks under the expand toggle in the icon rail", () => {
    for (const inset of [true, false]) {
      const markup = render(inset, true, SEARCH);
      assert.match(
        markup,
        /aria-label="Expand sidebar".*?<\/div><div class="flex flex-col items-center gap-1 pb-1"><button type="button" aria-label="Search">/,
      );
    }
  });

  it("renders nothing extra when the host passes none", () => {
    assert.ok(!render(true).includes("gap-0.5 pr-2"));
    assert.ok(
      !render(false, true).includes("flex-col items-center gap-1 pb-1"),
    );
  });
});
