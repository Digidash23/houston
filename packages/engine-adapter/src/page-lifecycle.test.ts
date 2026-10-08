import { describe, expect, test } from "vitest";
import {
  createPageLifecycle,
  type PageLifecycleTarget,
} from "./page-lifecycle";

function fakeWindow() {
  const handlers = new Map<string, () => void>();
  const target: PageLifecycleTarget = {
    addEventListener: (type, handler) => void handlers.set(type, handler),
  };
  return {
    target,
    fire: (type: "pagehide" | "pageshow") => handlers.get(type)?.(),
  };
}

describe("createPageLifecycle", () => {
  test("a page is not unloading until pagehide", () => {
    const w = fakeWindow();
    const lifecycle = createPageLifecycle(w.target);
    expect(lifecycle.isUnloading()).toBe(false);
    w.fire("pagehide");
    expect(lifecycle.isUnloading()).toBe(true);
  });

  test("a back/forward-cache restore (pageshow) is a live page again", () => {
    const w = fakeWindow();
    const lifecycle = createPageLifecycle(w.target);
    w.fire("pagehide");
    w.fire("pageshow");
    expect(lifecycle.isUnloading()).toBe(false);
  });

  test("no page at all is never unloading", () => {
    expect(createPageLifecycle(null).isUnloading()).toBe(false);
  });
});
