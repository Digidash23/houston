import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { MenuSection } from "../src/components/shell/menu-row.ts";
import { mobileMoreItems } from "../src/components/shell/mobile-more-items.ts";

// The phone More menu's model: the shared destination runs, minus the ones a
// gate emptied. One unlabelled run is composed today; the mapper keeps labels
// so the menu draws whatever runs it is handed.

const requireSource = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

const row = (id: string): MenuSection["items"][number] => ({
  id,
  label: id,
  icon: null,
  onClick: () => {},
});

describe("mobileMoreItems", () => {
  it("keeps the rail's runs, labels and order", () => {
    const groups = mobileMoreItems([
      {
        id: "primary",
        items: [row("ai-hub"), row("integrations")],
      },
      { id: "teams", label: "Your AI Employees", items: [row("team")] },
    ]);
    assert.deepEqual(
      groups.map((g) => [g.id, g.label, g.items.map((i) => i.id)]),
      [
        ["primary", undefined, ["ai-hub", "integrations"]],
        ["teams", "Your AI Employees", ["team"]],
      ],
    );
  });

  it("drops a run its gates emptied, band and all", () => {
    // A heading must never outlive the rows it names — the same rule the rail
    // library applies to its own sections.
    const groups = mobileMoreItems([
      { id: "primary", items: [row("ai-hub")] },
      { id: "teams", label: "Your AI Employees", items: [] },
    ]);
    assert.deepEqual(
      groups.map((g) => g.id),
      ["primary"],
    );
  });
});

describe("mobile More screen rows", () => {
  it("gates Admin and omits the Help group", () => {
    const source = requireSource(
      "../src/components/shell/mobile-more-menu.tsx",
    );
    assert.ok(
      source.includes(
        "{showOrganization && <MobileMoreRowButton row={admin} />}",
      ),
    );
    assert.ok(source.includes("adminNavRow({"), "the rail's own Admin row");
    const rows = requireSource("../src/components/shell/sidebar-nav-rows.tsx");
    assert.ok(rows.includes('dataAttrs: { "data-testid": "rail-admin" }'));
    assert.ok(!source.includes("mobileMoreFooterRows"));
    assert.ok(!source.includes("moreMenu.help"));
  });
});
