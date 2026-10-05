import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyOpenGroupIds } from "../src/sidebar-empty-group";
import { SidebarGroupedList } from "../src/sidebar-grouped-list";
import type { SidebarGroupView, SidebarRootEntry } from "../src/sidebar-groups";
import type { SidebarTreeRow } from "../src/sidebar-tree";

Object.assign(globalThis, { React });

describe("emptyOpenGroupIds", () => {
  it("names open groups with no member rows, never folded or filled ones", () => {
    const rows: SidebarTreeRow[] = [
      { kind: "group", id: "Empty", collapsed: false },
      { kind: "agent", id: "a", parentId: null },
      { kind: "group", id: "Folded", collapsed: true },
      { kind: "group", id: "Filled", collapsed: false },
      { kind: "agent", id: "b", parentId: "Filled" },
      { kind: "group", id: "Last", collapsed: false },
    ];
    assert.deepEqual([...emptyOpenGroupIds(rows)], ["Empty", "Last"]);
  });
});

// The report behind this: a group holding nobody, with three top-level agents
// right under it, folded and unfolded with nothing on screen changing.
const items = ["a", "b", "c"].map((id) => ({ id, name: id }));
const order: SidebarRootEntry[] = [
  { kind: "group", id: "Logistics" },
  { kind: "agent", id: "a" },
  { kind: "agent", id: "b" },
  { kind: "agent", id: "c" },
];
const rail = (groups: SidebarGroupView[], arrangeable = true) =>
  renderToStaticMarkup(
    React.createElement(SidebarGroupedList, {
      items,
      groups,
      order,
      rowCtx: { selectedId: null, onSelect: () => undefined },
      onArrange: arrangeable ? () => true : undefined,
      labels: { emptyGroup: "Drag an AI Employee here" },
    }),
  );
const logistics = (collapsed: boolean, itemIds: string[] = []) => [
  { id: "Logistics", name: "Logistics", collapsed, itemIds },
];
const hint = /data-sidebar-empty-group="Logistics"/;

describe("SidebarGroupedList empty group", () => {
  it("draws the hint under the open empty group, before the top-level rows", () => {
    const markup = rail(logistics(false));
    assert.match(markup, hint);
    assert.match(markup, /Drag an AI Employee here/);
    assert.ok(
      markup.indexOf("data-sidebar-empty-group") <
        markup.indexOf('data-item-id="a"'),
    );
  });

  it("folding the empty group hides the hint, so the toggle shows", () => {
    assert.doesNotMatch(rail(logistics(true)), hint);
  });

  it("draws no hint once the group has a member", () => {
    assert.doesNotMatch(rail(logistics(false, ["a"])), hint);
  });

  it("draws no drag hint where nothing can be dragged", () => {
    assert.doesNotMatch(rail(logistics(false), false), hint);
  });
});
