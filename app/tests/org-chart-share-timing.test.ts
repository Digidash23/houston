// The Share button's timing: the toast waits until the person is back on
// the page (LinkedIn took them to another tab or app), and a click while a
// share is still running is dropped.

import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  type SeenPage,
  whenSeen,
} from "../src/components/organization/org-chart-when-seen.ts";
import { createSingleFlight } from "../src/components/organization/single-flight.ts";

function page(visible: boolean, focused: boolean) {
  const listeners = new Map<string, Set<() => void>>();
  const state = { visible, focused };
  const fake: SeenPage = {
    get visibilityState() {
      return state.visible ? "visible" : "hidden";
    },
    hasFocus: () => state.focused,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
  };
  const fire = (type: string) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn();
  };
  const count = () =>
    [...listeners.values()].reduce((n, set) => n + set.size, 0);
  return { fake, state, fire, count };
}

describe("whenSeen", () => {
  it("shows at once on a visible, focused page", () => {
    const { fake, count } = page(true, true);
    let shown = 0;
    whenSeen(fake, () => shown++);
    strictEqual(shown, 1);
    strictEqual(count(), 0);
  });

  it("waits while the page is hidden or unfocused, then shows once", () => {
    const { fake, state, fire, count } = page(false, false);
    let shown = 0;
    whenSeen(fake, () => shown++);
    strictEqual(shown, 0);
    // Visible again but the window is still behind the browser.
    state.visible = true;
    fire("visibilitychange");
    strictEqual(shown, 0);
    state.focused = true;
    fire("focus");
    strictEqual(shown, 1);
    fire("focus");
    strictEqual(shown, 1);
    strictEqual(count(), 0);
  });

  it("cancels cleanly on unmount", () => {
    const { fake, state, fire, count } = page(true, false);
    let shown = 0;
    const cancel = whenSeen(fake, () => shown++);
    cancel();
    strictEqual(count(), 0);
    state.focused = true;
    fire("focus");
    strictEqual(shown, 0);
  });
});

describe("createSingleFlight", () => {
  it("drops calls while a task runs, and takes the next once it settles", async () => {
    const run = createSingleFlight();
    let finish!: () => void;
    const started: number[] = [];
    strictEqual(
      run(() => {
        started.push(1);
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      }),
      true,
    );
    strictEqual(
      run(async () => {
        started.push(2);
      }),
      false,
    );
    finish();
    await Promise.resolve();
    await Promise.resolve();
    strictEqual(
      run(() => {
        started.push(3);
        return Promise.reject(new Error("x"));
      }),
      true,
    );
    await Promise.resolve();
    await Promise.resolve();
    strictEqual(
      run(async () => {
        started.push(4);
      }),
      true,
    );
    deepStrictEqual(started, [1, 3, 4]);
  });
});
