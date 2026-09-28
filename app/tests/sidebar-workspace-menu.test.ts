import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const SECTIONS = read("../src/components/shell/sidebar-nav-sections.tsx");
const ROWS = read("../src/components/shell/sidebar-nav-rows.tsx");
const NAV = `${SECTIONS}\n${ROWS}`;
const FOOTER = read("../src/components/shell/sidebar-footer.tsx");
const MENU = read("../src/components/shell/sidebar-workspace-menu.tsx");
const ITEMS = read("../src/components/shell/sidebar-workspace-menu-items.tsx");
const ACCOUNT = read("../src/components/shell/workspace-account.tsx");
const RAIL = read("../src/components/shell/sidebar-rail.tsx");
const SHELL = read("../src/components/shell/workspace-shell.tsx");
const MORE_MENU = read("../src/components/shell/mobile-more-menu.tsx");

it("makes the shell card gap a drag region only for the native Mac window", () => {
  assert.match(
    SHELL,
    /data-tauri-drag-region=\{osIsTauri\(\) && isMac \? true : undefined\}\s+className="relative flex min-w-0 flex-1 gap-0 overflow-hidden md:gap-2"/,
  );
});

describe("the rail's foot", () => {
  it("is the update notice, then the workspace menu, and nothing else", () => {
    assert.ok(FOOTER.includes("<UpdateChecker collapsed={props.collapsed} />"));
    assert.ok(
      FOOTER.indexOf("<UpdateChecker") <
        FOOTER.indexOf("<SidebarWorkspaceMenu"),
    );
    // Identity lives in the Settings index: no second door onto that page.
    assert.ok(!FOOTER.includes("UserMenu"));
  });

  it("leaves the rail's body to the team: no destinations above it", () => {
    assert.ok(!RAIL.includes("navSections"));
    assert.ok(!RAIL.includes("sectionLabel"));
    assert.ok(RAIL.includes("headerActions={"));
  });
});

describe("the account row", () => {
  it("is the person over their workspace, on both breakpoints", () => {
    assert.ok(ACCOUNT.includes("title: profile?.name ?? workspaceName"));
    assert.ok(
      ACCOUNT.includes("subtitle: profile ? workspaceName : undefined"),
    );
    for (const host of [MENU, MORE_MENU]) {
      assert.ok(host.includes("useAccountFace()"));
    }
    // The tour anchor is the rail's alone: the phone's More button already
    // stands for the menu, and two anchors would race the spotlight.
    assert.ok(MENU.includes('dataAttrs={tourAnchor("workspaceMenu")}'));
    assert.ok(
      MORE_MENU.includes('dataAttrs={{ "data-testid": "more-account" }}'),
    );
    // The phone's trigger heads its card, so its menu opens downward.
    assert.ok(MORE_MENU.includes('side="bottom"'));
  });

  it("marks the current workspace with a leading check, no letter tiles", () => {
    assert.ok(!ACCOUNT.includes("WorkspaceMark"));
    // A checkbox item: the check is drawn AND announced as the current one.
    assert.ok(ACCOUNT.includes("<DropdownMenuCheckboxItem"));
    assert.ok(ACCOUNT.includes("checked={workspace.id === currentId}"));
    for (const host of [ITEMS, MORE_MENU]) {
      assert.ok(host.includes("<WorkspaceSwitchItems"));
    }
  });

  it("creates an organization where Spaces are served, a workspace elsewhere", () => {
    assert.ok(
      ACCOUNT.includes("const spacesEnabled = hasSpaces(capabilities)"),
    );
    assert.ok(ACCOUNT.includes("<CreateOrganizationDialog"));
    assert.ok(
      ACCOUNT.includes(
        "onCreate: spacesEnabled ? () => setOpen(true) : onCreateLocal",
      ),
    );
    for (const host of [MENU, MORE_MENU]) {
      assert.ok(host.includes("useWorkspaceCreate("));
      assert.ok(host.includes("{create.dialog}"));
    }
  });

  it("runs every item one tick AFTER the menu closes", () => {
    // Radix restores focus to the trigger when its content unmounts, which
    // lands after a synchronous handler has already moved the view.
    assert.ok(ACCOUNT.includes("return () => setTimeout(run, 0);"));
    assert.ok(ACCOUNT.includes("onSelect={afterClose(props.onSelect)}"));
  });
});

describe("the workspace menu", () => {
  it("lists workspaces, then the shared tools, then the person's own run", () => {
    const order = [
      "<WorkspaceSwitchItems",
      "props.tools.map(",
      "label={props.academy.label}",
      "label={props.settingsLabel}",
    ].map((needle) => ITEMS.indexOf(needle));
    assert.ok(
      order.every((at) => at >= 0),
      "every run is rendered",
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
  });

  it("builds its rows from the same builders as the phone's More card", () => {
    for (const host of [MENU, MORE_MENU]) {
      assert.ok(host.includes("useSidebarNavItems(t, "));
      assert.ok(host.includes("academyNavRow("));
      assert.ok(host.includes("adminNavRow({"));
    }
  });

  it("opens Settings on its INDEX, and carries no help control", () => {
    assert.ok(MENU.includes("onOpenSettings={() => openSettings(null)}"));
    assert.ok(ITEMS.includes('dataAttrs={tourAnchor("nav-settings")}'));
    // Report bug is a section inside Settings; the menu holds no help item.
    assert.ok(!MENU.includes("reportProblem"));
    assert.ok(!ITEMS.includes("reportProblem"));
  });

  it("leads the workspace run with Admin, behind the org gate, on both breakpoints", () => {
    assert.ok(MENU.includes("...(showOrganization"));
    assert.ok(
      MENU.indexOf("adminNavRow({") < MENU.indexOf("...navSections.flatMap("),
      "Admin comes before the shared tools",
    );
    assert.ok(
      MORE_MENU.indexOf(
        "{showOrganization && <MobileMoreRowButton row={admin} />}",
      ) < MORE_MENU.indexOf("{groups.map("),
      "and on the phone too",
    );
    assert.ok(ROWS.includes('dataAttrs: { "data-testid": "rail-admin" }'));
  });
});

describe("Settings is no destination", () => {
  it("is in no nav section at all", () => {
    assert.ok(!NAV.includes("SETTINGS_VIEW_ID"));
    assert.ok(!NAV.includes('tourAnchor("nav-settings")'));
  });
});
