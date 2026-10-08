import { describe, expect, test } from "vitest";
import {
  createPageLifecycle,
  type PageLifecycleTarget,
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
  return {
    target,
    schedule,
    fire: (type: "beforeunload" | "pagehide" | "pageshow") =>
      handlers.get(type)?.(),
    /** Run every live timer, as if its delay elapsed. */
    elapse: () => {
      for (const t of timers.splice(0)) if (t.live) t.fn();
    },
    timers,
  };
}

describe("createPageLifecycle", () => {
  test("a page is not unloading until it starts to leave", () => {
    const w = fakeWindow();
    const lifecycle = createPageLifecycle(w.target, w.schedule);
    expect(lifecycle.isUnloading()).toBe(false);
    w.fire("pagehide");
    expect(lifecycle.isUnloading()).toBe(true);
  });

  test("beforeunload counts from the navigation's start (Firefox cancels fetches there)", () => {
    const w = fakeWindow();
    const lifecycle = createPageLifecycle(w.target, w.schedule);
    w.fire("beforeunload");
    expect(lifecycle.isUnloading()).toBe(true);
    // The commit follows: the flag stays, and the cancel timer is dropped.
    w.fire("pagehide");
    w.elapse();
    expect(lifecycle.isUnloading()).toBe(true);
  });

  test("a beforeunload with no pagehide was a cancelled navigation", () => {
    const w = fakeWindow();
    const lifecycle = createPageLifecycle(w.target, w.schedule);
    w.fire("beforeunload");
    expect(w.timers[0]?.ms).toBe(UNLOAD_CANCELLED_AFTER_MS);
    w.elapse();
    expect(lifecycle.isUnloading()).toBe(false);
  });

  test("a back/forward-cache restore (pageshow) is a live page again", () => {
    const w = fakeWindow();
    const lifecycle = createPageLifecycle(w.target, w.schedule);
    w.fire("beforeunload");
    w.fire("pagehide");
    w.fire("pageshow");
    expect(lifecycle.isUnloading()).toBe(false);
    w.elapse();
    expect(lifecycle.isUnloading()).toBe(false);
  });

  test("no page at all is never unloading", () => {
    expect(createPageLifecycle(null).isUnloading()).toBe(false);
  });
});
