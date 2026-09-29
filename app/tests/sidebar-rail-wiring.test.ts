import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * The rail's list, its foot and the tour over them, guarded on SOURCE: the
 * modules are `.tsx` that mount stores and queries, so the node runner reads
 * them the way `sidebar-workspace-menu.test.ts` does.
 */
const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

const RAIL = read("../src/components/shell/sidebar-rail.tsx");
const HEADER = read("../src/components/shell/sidebar-header-actions.tsx");
const FOOTER = read("../src/components/shell/sidebar-footer.tsx");
const TOUR = read("../src/components/academy/lessons/registry.ts");

describe("the Add new AI Employee shortcut", () => {
  it("closes the list, in both rail states, for a caller who may create one", () => {
    assert.ok(RAIL.includes("listFooter={"));
    assert.ok(RAIL.includes("model.onAddAgent && (\n          <SidebarAddRow"));
    assert.ok(RAIL.includes("onClick={model.onAddAgent}"));
    assert.ok(RAIL.includes('label={t("shell:sidebar.addEmployee")}'));
    assert.ok(RAIL.includes('"data-testid": "rail-add-employee"'));
  });

  it("leaves the tour's newAgent anchor on the top line's create menu", () => {
    assert.ok(!RAIL.includes("tourAnchor"));
    assert.ok(HEADER.includes('dataAttrs={tourAnchor("newAgent")}'));
    assert.ok(HEADER.includes("<SidebarCreateButton"));
  });
});

describe("the rail's foot", () => {
  it("sets the connect rows, then the person's own row, under a hairline", () => {
    assert.ok(FOOTER.includes("border-line border-t"));
    const connect = FOOTER.indexOf("<ConnectGroup");
    const account = FOOTER.indexOf("<SidebarWorkspaceMenu");
    assert.ok(connect > 0 && account > connect);
  });
});

describe("the Houston tour", () => {
  it("lights the connect rows on the desktop, the account row for the Academy", () => {
    assert.ok(
      TOUR.includes('target: onEitherScreen("nav-ai-hub", "mobileMenu")'),
    );
    assert.ok(
      TOUR.includes('target: onEitherScreen("nav-integrations", "mobileMenu")'),
    );
    // The Academy lives in the account row's menu.
    assert.ok(
      TOUR.includes('target: onEitherScreen("workspaceMenu", "mobileMenu")'),
    );
  });
});

describe("the connect rows' provider marks", () => {
  const LOGOS = read("../src/components/shell/use-connect-group-logos.tsx");

  it("read the person's connections only once the integrations provider is ready", () => {
    // The rail is always mounted: an ungated read would hit a provider that
    // is not set up on every boot, as the catalog read beside it never does.
    assert.ok(LOGOS.includes("const ready = useIntegrationProviderReady();"));
    assert.ok(
      LOGOS.includes("useIntegrationConnections(INTEGRATION_PROVIDER, ready)"),
    );
  });

  it("follow the current theme's ink, so they read on the dark rail", () => {
    // Each mark sits on its tile's themed surface: a mark pinned to one
    // theme's ink vanishes on the other theme's tile.
    assert.ok(!LOGOS.includes("data-theme"));
    assert.ok(LOGOS.includes('className="flex text-ink"'));
  });
});
