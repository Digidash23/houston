import { describe, expect, test } from "vitest";
import {
  createPageLifecycle,
  type PageLifecycleTarget,
  pageTargetOf,
  UNLOAD_CANCELLED_AFTER_MS,
} from "./page-lifecycle";

function fakeWindow() {
  const handlers = new Map<string, () => void>();
  const target: PageLifecycleTarget = {
    addEventListener: (type, handler) => void handlers.set(type, handler),
  };
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const schedule = (fn: () => void, ms: number) => {
    const timer = { fn, ms, live: true };
    timers.push(timer);
    return () => {
      timer.live = false;
    };
  };
  const lifecycle = createPageLifecycle(target, schedule);
  let lives = 0;
  lifecycle.onLive(() => {
    lives += 1;
  });
  return {
    lifecycle,
    fire: (type: "beforeunload" | "pagehide" | "pageshow") =>
      handlers.get(type)?.(),
    /** Run every live timer, as if its delay elapsed. */
    elapse: () => {
      for (const t of timers.splice(0)) if (t.live) t.fn();
    },
    timers,
    lives: () => lives,
  };
}

describe("createPageLifecycle", () => {
  test("a page is not unloading until it starts to leave", () => {
    const w = fakeWindow();
    expect(w.lifecycle.isUnloading()).toBe(false);
    w.fire("pagehide");
    expect(w.lifecycle.isUnloading()).toBe(true);
    expect(w.lives()).toBe(0);
  });

  test("beforeunload counts from the navigation's start (Firefox cancels fetches there)", () => {
    const w = fakeWindow();
    w.fire("beforeunload");
    expect(w.lifecycle.isUnloading()).toBe(true);
    // The commit follows: the flag stays, and the cancel timer is dropped.
    w.fire("pagehide");
    w.elapse();
    expect(w.lifecycle.isUnloading()).toBe(true);
    expect(w.lives()).toBe(0);
  });

  test("a beforeunload with no pagehide was a cancelled navigation: live again", () => {
    const w = fakeWindow();
    w.fire("beforeunload");
    expect(w.timers[0]?.ms).toBe(UNLOAD_CANCELLED_AFTER_MS);
    w.elapse();
    expect(w.lifecycle.isUnloading()).toBe(false);
    expect(w.lives()).toBe(1);
  });

  test("a repeated beforeunload re-arms the timer: one live, when the last one lapses", () => {
    const w = fakeWindow();
    w.fire("beforeunload");
    const first = w.timers[0];
    w.fire("beforeunload");
    expect(first?.live).toBe(false);
    expect(w.timers).toHaveLength(2);
    w.elapse();
    expect(w.lives()).toBe(1);
    expect(w.lifecycle.isUnloading()).toBe(false);
  });

  test("a back/forward-cache restore (pageshow) is a live page again, once", () => {
    const w = fakeWindow();
    w.fire("beforeunload");
    w.fire("pagehide");
    w.fire("pageshow");
    expect(w.lifecycle.isUnloading()).toBe(false);
    expect(w.lives()).toBe(1);
    w.elapse();
    expect(w.lives()).toBe(1);
  });

  test("a pageshow on a page that never left reports nothing", () => {
    const w = fakeWindow();
    w.fire("pageshow");
    expect(w.lives()).toBe(0);
  });

  test("onLive's return stops the listener", () => {
    const w = fakeWindow();
    let extra = 0;
    const stop = w.lifecycle.onLive(() => {
      extra += 1;
    });
    stop();
    w.fire("beforeunload");
    w.elapse();
    expect(extra).toBe(0);
    expect(w.lives()).toBe(1);
  });

  test("no page at all is never unloading", () => {
    expect(createPageLifecycle(null).isUnloading()).toBe(false);
  });
});

describe("pageTargetOf", () => {
  test("a bare window stub without an event surface is no page", () => {
    expect(pageTargetOf({})).toBeNull();
    expect(pageTargetOf(undefined)).toBeNull();
    expect(pageTargetOf(null)).toBeNull();
  });

  test("anything with addEventListener is the page", () => {
    const target = { addEventListener: () => {} };
    expect(pageTargetOf(target)).toBe(target);
  });
});
