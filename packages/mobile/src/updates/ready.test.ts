// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  declareProvisionalReady,
  declareReadyWhenShellRenders,
  PROVISIONAL_READY_KEY,
  PROVISIONAL_RENDER_DEADLINE_MS,
  type ReadyPorts,
  SHELL_SETTLE_MS,
} from "./ready";

// jsdom's localStorage is unavailable under this Node; an in-memory Storage
// slice is all the readiness module touches.
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
  removeItem: (key: string) => {
    values.delete(key);
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  values.clear();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => vi.useRealTimers());

function ports(bundleId = "ota-7"): ReadyPorts & {
  notifyAppReady: ReturnType<typeof vi.fn>;
  resetToBuiltin: ReturnType<typeof vi.fn>;
  report: ReturnType<typeof vi.fn>;
} {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing root");
  return {
    root,
    notifyAppReady: vi.fn().mockResolvedValue({}),
    currentBundleId: async () => bundleId,
    resetToBuiltin: vi.fn().mockResolvedValue(undefined),
    storage,
    report: vi.fn(),
  };
}

const render = (html: string) => {
  const root = document.getElementById("root");
  if (root) root.innerHTML = html;
};

test("the loading splash alone never marks the bundle ready", async () => {
  const p = ports();
  render("<div data-houston-boot-loading></div>");
  declareReadyWhenShellRenders(p);
  await vi.advanceTimersByTimeAsync(PROVISIONAL_RENDER_DEADLINE_MS);
  expect(p.notifyAppReady).not.toHaveBeenCalled();
  expect(p.resetToBuiltin).not.toHaveBeenCalled();
});

test("the real app shell marks the bundle ready once it stays up", async () => {
  const p = ports();
  render("<div data-houston-boot-loading></div>");
  declareReadyWhenShellRenders(p);
  render("<main>Sign in</main>");
  await vi.advanceTimersByTimeAsync(SHELL_SETTLE_MS - 1);
  expect(p.notifyAppReady).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(p.notifyAppReady).toHaveBeenCalledOnce();
});

test("a crash right after first paint is never marked ready", async () => {
  const p = ports();
  declareReadyWhenShellRenders(p);
  render("<main>Shell</main>");
  await vi.advanceTimersByTimeAsync(SHELL_SETTLE_MS / 2);
  render("<div data-houston-boot-crashed>boom</div>");
  await vi.advanceTimersByTimeAsync(PROVISIONAL_RENDER_DEADLINE_MS);
  expect(p.notifyAppReady).not.toHaveBeenCalled();
});

test("an offline launch marks an OTA bundle ready provisionally", async () => {
  const p = ports("ota-7");
  await declareProvisionalReady(p);
  expect(p.notifyAppReady).toHaveBeenCalledOnce();
  expect(storage.getItem(PROVISIONAL_READY_KEY)).toBe("ota-7");
  const builtin = ports("builtin");
  values.clear();
  await declareProvisionalReady(builtin);
  expect(storage.getItem(PROVISIONAL_READY_KEY)).toBeNull();
});

test("a provisional bundle that crashes online is reset to builtin and reported", async () => {
  storage.setItem(PROVISIONAL_READY_KEY, "ota-7");
  const p = ports("ota-7");
  declareReadyWhenShellRenders(p);
  render("<div data-houston-boot-crashed>boom</div>");
  await vi.advanceTimersByTimeAsync(0);
  expect(p.resetToBuiltin).toHaveBeenCalledOnce();
  expect(p.report).toHaveBeenCalledWith(expect.any(Error));
  expect(storage.getItem(PROVISIONAL_READY_KEY)).toBeNull();
});

test("a provisional bundle that never renders the app online is reset", async () => {
  storage.setItem(PROVISIONAL_READY_KEY, "ota-7");
  const p = ports("ota-7");
  render("<div data-houston-boot-loading></div>");
  declareReadyWhenShellRenders(p);
  await vi.advanceTimersByTimeAsync(PROVISIONAL_RENDER_DEADLINE_MS);
  expect(p.resetToBuiltin).toHaveBeenCalledOnce();
});

test("a provisional bundle that renders online is confirmed", async () => {
  storage.setItem(PROVISIONAL_READY_KEY, "ota-7");
  const p = ports("ota-7");
  declareReadyWhenShellRenders(p);
  render("<main>Shell</main>");
  await vi.advanceTimersByTimeAsync(PROVISIONAL_RENDER_DEADLINE_MS);
  expect(p.notifyAppReady).toHaveBeenCalledOnce();
  expect(p.resetToBuiltin).not.toHaveBeenCalled();
  expect(storage.getItem(PROVISIONAL_READY_KEY)).toBeNull();
});
