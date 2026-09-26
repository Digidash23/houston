// Real-DOM mount of the real AppSidebar (the ui/chat interaction-card-mount
// pattern: jsdom globals BEFORE the dynamic react-dom import), since the
// grouped rail portals its drag overlay into the document.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import type { SidebarItem, SidebarProps } from "../src/sidebar-props.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
for (const key of ["Element", "HTMLElement", "Node", "Event"]) {
  g[key] = (dom.window as unknown as Record<string, unknown>)[key];
}
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
// ui/core's Radix wrappers are authored against the classic JSX runtime, which
// resolves `React` off the global scope.
g.React = React;
const { act, createElement: h } = React;
const { createRoot } = await import("react-dom/client");
const { AppSidebar } = await import("../src/sidebar.tsx");
const { useSidebarAvatarDiameter } = await import(
  "../src/sidebar-avatar-diameter.tsx"
);

/** Prints the diameter the rail hands the avatar where it is mounted. */
function Portrait() {
  return h("i", { "data-diameter": useSidebarAvatarDiameter() });
}

const PINNED: SidebarItem = {
  id: "manager",
  name: "Manager",
  subtitle: "Runs the team",
  icon: h(Portrait),
  dataAttrs: { "data-testid": "pinned-manager" },
};
const agent = (id: string): SidebarItem => ({
  id,
  name: id,
  subtitle: "Role",
  icon: h(Portrait),
});

/** Mounts the rail and returns its markup. */
function render(props: Partial<SidebarProps>): string {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      h(AppSidebar, {
        items: [agent("ada"), agent("bob")],
        pinnedItems: [PINNED],
        onSelect: () => {},
        ...props,
      }),
    );
  });
  const html = container.innerHTML;
  act(() => root.unmount());
  container.remove();
  return html;
}

/** The markup of the element carrying `data-testid="pinned-manager"`, up to
 *  the end of its button. */
const pinnedRow = (html: string) => {
  const start = html.indexOf('data-testid="pinned-manager"');
  assert.ok(start >= 0, "the pinned row renders with its data attributes");
  return html.slice(start, html.indexOf("</button>", start));
};

const GROUPED: Partial<SidebarProps> = {
  groups: [{ id: "team", name: "Sales", collapsed: false, itemIds: ["ada"] }],
  order: [
    { kind: "group", id: "team" },
    { kind: "agent", id: "bob" },
  ],
};

describe("AppSidebar pinned items", () => {
  it("leads the grouped list, ahead of every group and employee", () => {
    const html = render(GROUPED);
    const pinned = html.indexOf('data-testid="pinned-manager"');
    assert.ok(pinned >= 0);
    assert.ok(pinned < html.indexOf(">Sales<"), "before the group header");
    assert.ok(pinned < html.indexOf(">ada<"), "before the group's employees");
    assert.ok(pinned < html.indexOf(">bob<"), "before the root employees");
    assert.equal(html.match(/data-testid="pinned-manager"/g)?.length, 1);
  });

  it("is a person row that never drags, and is not a sortable item", () => {
    const html = render(GROUPED);
    const row = pinnedRow(html);
    assert.ok(row.includes(">Manager<") && row.includes(">Runs the team<"));
    assert.ok(row.includes('data-diameter="32"'), "the portrait diameter");
    assert.ok(!row.includes("cursor-grab"), "no drag cursor");
    assert.ok(!row.includes("data-sidebar-item"));
    // The employees keep theirs: they are still sortable rows.
    assert.equal(html.match(/data-sidebar-item=""/g)?.length, 2);
  });

  it("is selected through the shared selectedId, like an employee", () => {
    assert.ok(
      pinnedRow(render({ ...GROUPED, selectedId: "manager" })).includes(
        'aria-current="page"',
      ),
    );
    assert.ok(
      !pinnedRow(render({ ...GROUPED, selectedId: "ada" })).includes(
        "aria-current",
      ),
    );
  });

  it("stays in view when the band folds its list away", () => {
    const html = render({
      ...GROUPED,
      sectionLabel: "Your AI Employees",
      sectionCollapsed: true,
      onToggleSectionCollapsed: () => {},
    });
    assert.ok(html.includes('data-testid="pinned-manager"'));
    assert.ok(!html.includes(">ada<"), "the folded list is gone");
    assert.ok(!html.includes(">bob<"));
  });

  it("leads the expanded flat list too", () => {
    const html = render({});
    const pinned = html.indexOf('data-testid="pinned-manager"');
    assert.ok(pinned >= 0 && pinned < html.indexOf(">ada<"));
    assert.ok(!pinnedRow(html).includes("cursor-grab"));
  });

  it("leads the collapsed rail as an avatar button at the collapsed diameter", () => {
    const html = render({ collapsed: true, selectedId: "manager" });
    const buttons = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map(
      (m) => m[1],
    );
    const people = buttons.filter((b) => ["Manager", "ada", "bob"].includes(b));
    assert.deepEqual(people, ["Manager", "ada", "bob"]);
    const tag = html.match(
      /<button[^>]*data-testid="pinned-manager"[^>]*>/,
    )?.[0];
    assert.ok(tag, "the test id lands on the collapsed button");
    assert.ok(tag.includes('aria-label="Manager"'));
    assert.ok(tag.includes("bg-sidebar-active"), "selected");
    assert.ok(pinnedRow(html).includes('data-diameter="24"'));
  });

  it("renders nothing extra when there is nothing pinned", () => {
    const html = render({ ...GROUPED, pinnedItems: [] });
    assert.ok(!html.includes("pinned-manager"));
    assert.ok(!html.includes("pb-px"));
  });
});
