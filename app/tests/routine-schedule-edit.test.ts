// The routine schedule editor writes only real edits, and never "":
// - opening it on a legacy schedule the picker now spells differently (`*/16`
//   is written `@every 16m` today) and saving without edits writes nothing;
// - an agent changing the schedule while it is open is not overwritten by a
//   no-edit Save;
// - an invalid pick (cleared count) cannot be saved;
// - re-clicking the current preset/unit or retyping the same count is not an
//   edit, while typing `05` over `5` is one and writes.
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
const { DEFAULT_ROW_LABELS, RoutineRowScheduleEdit, ScheduleBuilder } =
  await import("@houston-ai/routines");

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

/** Types into the interval count the way a person does (React's onChange). */
async function typeCount(text: string) {
  const input = document.getElementById("interval-picker-every");
  if (!(input instanceof win.HTMLInputElement)) throw new Error("no count");
  const setValue = Object.getOwnPropertyDescriptor(
    win.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setValue?.call(input, text);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
}

/** Mounts `element` in a fresh container; returns rerender and unmount. */
async function mount(element: ReturnType<typeof h>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    rerender: (next: ReturnType<typeof h>) =>
      act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** Mounts the editor on `cron`; `setCron` re-renders it with a new live one. */
async function mountEditor(cron: string) {
  const writes: string[] = [];
  const editor = (live: string) =>
    h(RoutineRowScheduleEdit, {
      routineId: "r1",
      cron: live,
      summary: "summary",
      onScheduleChange: (_id: string, next: string) => writes.push(next),
      labels: DEFAULT_ROW_LABELS,
    });
  const mounted = await mount(editor(cron));
  return {
    writes,
    setCron: (live: string) => mounted.rerender(editor(live)),
    unmount: mounted.unmount,
  };
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

describe("Save in the schedule editor", () => {
  it("never writes the opened schedule over an agent's change", async () => {
    const editor = await mountEditor("0 9 * * *");
    try {
      await click(DEFAULT_ROW_LABELS.editSchedule);
      // The agent moves the routine while the editor is open.
      await editor.setCron("0 10 * * *");
      await click(DEFAULT_ROW_LABELS.save);
      assert.deepEqual(editor.writes, []);
    } finally {
      await editor.unmount();
    }
  });

  it("is disabled while the pick is invalid", async () => {
    const editor = await mountEditor("*/16 * * * *");
    try {
      await click(DEFAULT_ROW_LABELS.editSchedule);
      await typeCount("");
      assert.equal(button(DEFAULT_ROW_LABELS.save).disabled, true);
      await click(DEFAULT_ROW_LABELS.save);
      assert.deepEqual(editor.writes, []);
      await typeCount("20");
      assert.equal(button(DEFAULT_ROW_LABELS.save).disabled, false);
      await click(DEFAULT_ROW_LABELS.save);
      assert.deepEqual(editor.writes, ["*/20 * * * *"]);
    } finally {
      await editor.unmount();
    }
  });
});

describe("what the schedule builder counts as an edit", () => {
  async function mountBuilder(value: string) {
    const emitted: string[] = [];
    const mounted = await mount(
      h(ScheduleBuilder, { value, onChange: (v: string) => emitted.push(v) }),
    );
    return { emitted, unmount: mounted.unmount };
  }

  it("re-clicking the current preset or unit, or retyping the count, is not one", async () => {
    const builder = await mountBuilder("*/16 * * * *");
    try {
      await click("Custom");
      await click("minutes");
      await typeCount("16");
      assert.deepEqual(builder.emitted, []);
    } finally {
      await builder.unmount();
    }
  });

  it("typing 05 over 5 is one, and writes", async () => {
    const builder = await mountBuilder("*/5 * * * *");
    try {
      await typeCount("05");
      assert.deepEqual(builder.emitted, ["*/5 * * * *"]);
    } finally {
      await builder.unmount();
    }
  });
});
