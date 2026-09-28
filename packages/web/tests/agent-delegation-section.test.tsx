import "../../../app/tests/support/dom-env";
import type { AgentDelegation } from "@houston/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../../../app/src/lib/types";

globalThis.DocumentFragment = window.DocumentFragment;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.MutationObserver = window.MutationObserver;
globalThis.CustomEvent = window.CustomEvent;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.HTMLElement.prototype.scrollIntoView = () => {};

const mock = vi.hoisted(() => ({
  policy: { mode: "all", agents: [], acceptsMissions: true } as AgentDelegation,
  roster: [] as Agent[],
  pending: false,
  mutate:
    vi.fn<(change: (current: AgentDelegation) => AgentDelegation) => void>(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (key === "delegation.outgoing.aria")
        return `${values?.name} gives missions to`;
      if (key === "delegation.incoming.aria")
        return `${values?.name} takes missions from`;
      return `${key}${values?.other ? `:${values.other}` : ""}`;
    },
  }),
}));
vi.mock("../../../app/src/hooks/queries/use-agent-delegation", () => ({
  useAgentDelegation: () => ({ data: mock.policy, isPending: mock.pending }),
  useSetAgentDelegation: () => ({ mutate: mock.mutate }),
}));
vi.mock("../../../app/src/stores/agents", () => ({
  useAgentStore: (select: (state: object) => unknown) =>
    select({ loadedWorkspaceId: "Personal", agents: mock.roster }),
}));
vi.mock("../../../app/src/stores/workspaces", () => ({
  useWorkspaceStore: (select: (state: object) => unknown) =>
    select({ current: { id: "Personal" } }),
}));

import { AgentDelegationSection } from "../../../app/src/components/agent-settings/agent-delegation-section";

const agent = (name: string) =>
  ({
    id: `Personal/${name}`,
    name,
    folderPath: `Personal/${name}`,
    role: "Specialist",
  }) as Agent;
const scout = agent("Scout");
const others = ["Writer", "Editor", "Analyst"].map(agent);
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function render() {
  await act(async () => root.render(<AgentDelegationSection agent={scout} />));
}
async function click(element: Element | null | undefined) {
  if (!element) throw new Error("Expected control to exist");
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}
async function choose(selectName: string, optionName: string) {
  const trigger = [...host.querySelectorAll('[role="combobox"]')].find(
    (element) => element.getAttribute("aria-label") === selectName,
  );
  if (!trigger) throw new Error(`Missing select: ${selectName}`);
  await act(async () => {
    trigger.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
  });
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (element) => element.textContent === optionName,
  );
  if (!option) throw new Error(`Missing option: ${optionName}`);
  await click(option);
}

describe("Teamwork settings", () => {
  beforeEach(() => {
    mock.policy = { mode: "all", agents: [], acceptsMissions: true };
    mock.roster = [scout, ...others];
    mock.pending = false;
    mock.mutate.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("has one card, two identically sized selects, and accessible names", async () => {
    await render();
    expect(host.querySelectorAll("section")).toHaveLength(1);
    expect(host.querySelector("h1, h2")).toBeNull();
    const selects = [...host.querySelectorAll('[role="combobox"]')];
    expect(selects.map((select) => select.getAttribute("aria-label"))).toEqual([
      "Scout gives missions to",
      "Scout takes missions from",
    ]);
    expect(selects[0]?.className).toContain("md:w-48");
    expect(selects[0]?.className).toBe(selects[1]?.className);
    expect(host.textContent).toContain("delegation.outgoing.label");
    expect(host.textContent).toContain("delegation.incoming.label");
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(0);
  });

  it("changes outgoing and incoming policies through their selects", async () => {
    await render();
    await choose("Scout gives missions to", "delegation.outgoing.none");
    expect(mock.mutate.mock.lastCall?.[0](mock.policy)).toEqual({
      mode: "off",
      agents: [],
      acceptsMissions: true,
    });
    mock.policy = { mode: "off", agents: [], acceptsMissions: true };
    await render();
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(0);
    await choose("Scout gives missions to", "delegation.outgoing.picked");
    expect(mock.mutate.mock.lastCall?.[0](mock.policy)).toEqual({
      mode: "picked",
      agents: [],
      acceptsMissions: true,
    });
    mock.policy = { mode: "picked", agents: [], acceptsMissions: true };
    await render();
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(
      others.length,
    );
    await choose("Scout takes missions from", "delegation.incoming.none");
    expect(mock.mutate.mock.lastCall?.[0](mock.policy)).toEqual({
      mode: "picked",
      agents: [],
      acceptsMissions: false,
    });
    mock.policy = { mode: "picked", agents: [], acceptsMissions: false };
    await render();
    await choose("Scout takes missions from", "delegation.incoming.everyone");
    expect(mock.mutate.mock.lastCall?.[0](mock.policy)).toEqual({
      mode: "picked",
      agents: [],
      acceptsMissions: true,
    });
    await choose("Scout gives missions to", "delegation.outgoing.everyone");
    expect(mock.mutate.mock.lastCall?.[0](mock.policy)).toEqual({
      mode: "all",
      agents: [],
      acceptsMissions: false,
    });
  });

  it("toggles a peer from the whole nested row", async () => {
    mock.policy = { mode: "picked", agents: [], acceptsMissions: true };
    mock.roster.push(agent(".hidden"));
    await render();
    const labels = [...host.querySelectorAll("label")];
    expect(labels).toHaveLength(others.length);
    expect(labels[0]?.textContent).toBe("Writer");
    expect(labels[0]?.querySelector("svg")).not.toBeNull();
    expect(
      labels[0]?.querySelector('[role="switch"]')?.getAttribute("aria-label"),
    ).toBe("delegation.picker.rowAria:Writer");
    expect(host.textContent).not.toContain(".hidden");
    await click(labels[0]);
    expect(mock.mutate.mock.lastCall?.[0](mock.policy)).toEqual({
      ...mock.policy,
      agents: [others[0].id],
    });
  });

  it("shows one muted nested line for an empty roster", async () => {
    mock.policy = { mode: "picked", agents: [], acceptsMissions: true };
    mock.roster = [scout];
    await render();
    expect(host.querySelectorAll("label")).toHaveLength(0);
    expect(host.querySelector(".text-ink-muted")?.textContent).toBe(
      "delegation.picker.empty",
    );
  });

  it("mirrors one card with two rows while loading", async () => {
    mock.pending = true;
    await render();
    expect(host.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
    expect(host.querySelectorAll('[role="combobox"]')).toHaveLength(0);
  });
});
