import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { TooltipProvider } from "@houston-ai/core";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useSidebarAvatarDiameter } from "../src/sidebar-avatar-diameter";
import { SidebarProfileMenu } from "../src/sidebar-profile-menu";

Object.assign(globalThis, { React });
const h = React.createElement;

/** Prints the diameter the rail hands it, so a test can read the slot size. */
function Portrait() {
  return h("span", { "data-diameter": useSidebarAvatarDiameter() });
}

function render(collapsed: boolean, subtitle?: string) {
  return renderToStaticMarkup(
    h(
      TooltipProvider,
      null,
      h(
        SidebarProfileMenu,
        {
          avatar: h(Portrait),
          title: "Julian Arango",
          subtitle,
          collapsed,
          dataAttrs: { "data-tour-target": "workspaceMenu" },
        },
        h("span", null, "menu-entry-marker"),
      ),
    ),
  );
}

describe("SidebarProfileMenu", () => {
  it("is a person row: portrait, name, and the workspace under it", () => {
    const markup = render(false, "Acme");
    assert.match(markup, /data-tour-target="workspaceMenu"/);
    assert.match(markup, /data-diameter="40"/);
    assert.match(markup, /h-16/);
    assert.match(markup, /font-semibold text-ink">Julian Arango<\/span>/);
    assert.match(markup, /text-ink-muted">Acme<\/span>/);
    assert.match(markup, /aria-haspopup="menu"/);
  });

  it("carries no chevron and no letter tile", () => {
    const markup = render(false, "Acme");
    assert.ok(!markup.includes("lucide-chevron"));
    assert.ok(!markup.includes("rounded-md border"));
  });

  it("draws the name alone when there is no second line", () => {
    const markup = render(false);
    assert.ok(!markup.includes("text-ink-muted"));
  });

  it("shrinks to the collapsed rail's portrait, named by its label", () => {
    const markup = render(true, "Acme");
    assert.match(markup, /aria-label="Julian Arango"/);
    assert.match(markup, /data-diameter="24"/);
  });

  it("keeps its items closed until opened", () => {
    assert.ok(!render(false, "Acme").includes("menu-entry-marker"));
  });
});
