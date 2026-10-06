// Opening a routine's schedule editor on a legacy schedule the picker now
// spells differently (`*/16` is written `@every 16m` today) must not rewrite it:
// Save with no edits writes nothing, and only a real edit writes the new form.
// Mounted in a real (jsdom) DOM so the popover, the builder's effects and the
// Save path are the shipped ones.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import "./support/dom-env.ts";

const g = globalThis as unknown as Record<string, unknown>;
const win = g.window as Window & typeof globalThis;
for (const key of [
  "CustomEvent",
  "DOMRect",
  "DocumentFragment",
  "FocusEvent",
  "HTMLButtonElement",
  "HTMLInputElement",
  "KeyboardEvent",
  "MouseEvent",
  "MutationObserver",
  "NodeFilter",
  "PointerEvent",
  "SVGElement",
  "ShadowRoot",
  "Text",
  "cancelAnimationFrame",
  "getComputedStyle",
  "requestAnimationFrame",
])
  g[key] = (win as unknown as Record<string, unknown>)[key];
win.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof win.matchMedia;
g.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const React = await import("react");
const { act, createElement: h } = React;
g.React = React;
const { createRoot } = await import("react-dom/client");
const { DEFAULT_ROW_LABELS, RoutineRowScheduleEdit } = await import(
  "@houston-ai/routines"
);

function button(name: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === name || b.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

async function click(name: string) {
  await act(async () => {
    button(name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Mounts the editor on `cron`; returns the writes and an unmount. */
async function mountEditor(cron: string) {
  const writes: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      h(RoutineRowScheduleEdit, {
        routineId: "r1",
        cron,
        summary: "summary",
        onScheduleChange: (_id: string, next: string) => writes.push(next),
        labels: DEFAULT_ROW_LABELS,
      }),
    ),
  );
  const unmount = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { writes, unmount };
}

describe("the schedule editor on a legacy schedule", () => {
  for (const [legacy, edited] of [
    ["*/16 * * * *", "@every 17m"],
    ["0 */5 * * *", "0 */6 * * *"],
  ]) {
    it(`leaves ${legacy} alone until edited, then writes ${edited}`, async () => {
      const editor = await mountEditor(legacy);
      try {
        await click(DEFAULT_ROW_LABELS.editSchedule);
        await click(DEFAULT_ROW_LABELS.save);
        assert.deepEqual(
          editor.writes,
          [],
          "Save with no edits writes nothing",
        );

        await click(DEFAULT_ROW_LABELS.editSchedule);
        await click("Increase");
        await click(DEFAULT_ROW_LABELS.save);
        assert.deepEqual(editor.writes, [edited]);
      } finally {
        await editor.unmount();
      }
    });
  }
});

describe("the interval stepper", () => {
  it("stops `+` at the unit's maximum", async () => {
    const editor = await mountEditor("@every 168h");
    try {
      await click(DEFAULT_ROW_LABELS.editSchedule);
      assert.equal(button("Increase").disabled, true);
      assert.equal(button("Decrease").disabled, false);
    } finally {
      await editor.unmount();
    }
  });
});
