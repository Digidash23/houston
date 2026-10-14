// The Share button's timing: the toast waits until the person is back from
// LinkedIn (another tab, or the system browser from the desktop app, whose
// open returns before the browser takes focus), a stale one is dropped, and
// a click while a share is still running is dropped.

import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { describe, it } from "node:test";
import {
  type Clock,
  LEAVE_GRACE_MS,
  type SeenPage,
  STALE_MS,
  showWhenBack,
  watchDeparture,
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
  const leave = () => {
    state.focused = false;
    fire("blur");
  };
  const back = () => {
    state.visible = true;
    state.focused = true;
    fire("visibilitychange");
    fire("focus");
  };
  const count = () =>
    [...listeners.values()].reduce((n, set) => n + set.size, 0);
  return { fake, state, fire, leave, back, count };
}

/** A clock this test moves by hand. */
function clock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const fake: Clock = {
    setTimeout: (fn, ms) => {
      timers.set(++next, { at: now + ms, fn });
      return next;
    },
    clearTimeout: (id) => timers.delete(id as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at))
      if (timer.at <= now && timers.delete(id)) timer.fn();
  };
  return { fake, advance, pending: () => timers.size };
}

describe("showWhenBack", () => {
  it("waits when the page is focused at landing and blurs 300 ms later", () => {
    const p = page(true, true);
    const c = clock();
    const departure = watchDeparture(p.fake);
    let shown = 0;
    showWhenBack(p.fake, () => shown++, {
      departure,
      expectLeave: true,
      clock: c.fake,
    });
    c.advance(300);
    p.leave();
    c.advance(LEAVE_GRACE_MS * 4);
    strictEqual(shown, 0);
    p.back();
    strictEqual(shown, 1);
    departure.stop();
    strictEqual(p.count(), 0);
    strictEqual(c.pending(), 0);
  });

  it("waits for the return when the person already left before landing", () => {
    const p = page(true, true);
    const c = clock();
    const departure = watchDeparture(p.fake);
    p.leave();
    let shown = 0;
    showWhenBack(p.fake, () => shown++, {
      departure,
      expectLeave: true,
      clock: c.fake,
    });
    strictEqual(shown, 0);
    p.back();
    strictEqual(shown, 1);
  });

  it("shows after the grace when nobody leaves (a tab that opened behind)", () => {
    const p = page(true, true);
    const c = clock();
    let shown = 0;
    showWhenBack(p.fake, () => shown++, {
      departure: watchDeparture(p.fake),
      expectLeave: true,
      clock: c.fake,
    });
    c.advance(LEAVE_GRACE_MS - 1);
    strictEqual(shown, 0);
    c.advance(1);
    strictEqual(shown, 1);
  });

  it("shows at once when nothing opened and the page is seen", () => {
    const p = page(true, true);
    let shown = 0;
    showWhenBack(p.fake, () => shown++, {
      expectLeave: false,
      clock: clock().fake,
    });
    strictEqual(shown, 1);
  });

  it("drops a toast nobody came back for, departure watcher included", () => {
    const p = page(false, false);
    const c = clock();
    let shown = 0;
    showWhenBack(p.fake, () => shown++, {
      departure: watchDeparture(p.fake),
      expectLeave: false,
      clock: c.fake,
    });
    c.advance(STALE_MS);
    p.back();
    strictEqual(shown, 0);
    strictEqual(p.count(), 0);
    strictEqual(c.pending(), 0);
  });

  it("cancels cleanly on unmount", () => {
    const p = page(true, false);
    const c = clock();
    let shown = 0;
    const cancel = showWhenBack(p.fake, () => shown++, {
      expectLeave: false,
      clock: c.fake,
    });
    cancel();
    strictEqual(p.count(), 0);
    strictEqual(c.pending(), 0);
    p.back();
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

  it("releases and rethrows when the task throws before returning a promise", () => {
    const run = createSingleFlight();
    throws(
      () =>
        run(() => {
          throw new URIError("URI malformed");
        }),
      URIError,
    );
    strictEqual(
      run(async () => {}),
      true,
    );
  });
});
