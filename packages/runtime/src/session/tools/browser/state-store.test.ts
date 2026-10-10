import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BrowserContext } from "playwright-core";
import { expect, test } from "vitest";
import { EMPTY_STATE, type StorageState } from "./state-merge";
import {
  browserStatePath,
  readState,
  type StateHolder,
  saveState,
} from "./state-store";

/** An agent workspace: it always has its `.houston/` dir. */
const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), "browser-state-"));
  mkdirSync(join(dir, ".houston"));
  return dir;
};

function cookie(name: string, value: string) {
  return {
    name,
    value,
    domain: "example.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };
}

/** A holder whose context reports `state` (saveState reads nothing else). */
function holder(statePath: string, state: () => StorageState): StateHolder {
  const asked: unknown[] = [];
  // SAFETY: saveState reads only storageState from the context.
  const context = {
    storageState: async (options: unknown) => {
      asked.push(options);
      return state();
    },
  } as unknown as BrowserContext;
  return { context, statePath, base: EMPTY_STATE };
}

test("sign-ins live in the agent's .houston/browser/state.json", () => {
  expect(browserStatePath("/ws/Agent")).toBe(
    "/ws/Agent/.houston/browser/state.json",
  );
});

test("saving writes the merged state atomically, owner-only", async () => {
  const path = browserStatePath(workspace());
  const state = { cookies: [cookie("sid", "abc")], origins: [] };
  const h = holder(path, () => state);
  await saveState(h);
  expect(await readState(path)).toEqual(state);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  // The next save diffs against what this context just wrote.
  expect(h.base).toEqual(state);
  // No half-written scratch file is left for the store sync to find.
  expect(readdirSync(dirname(path))).toEqual(["state.json"]);
});

test("two conversations saving at once both keep their sign-ins", async () => {
  const path = browserStatePath(workspace());
  const a = holder(path, () => ({
    cookies: [cookie("a_sid", "1")],
    origins: [],
  }));
  const b = holder(path, () => ({
    cookies: [cookie("b_sid", "2")],
    origins: [],
  }));
  await Promise.all([saveState(a), saveState(b), saveState(a)]);
  const saved = JSON.parse(readFileSync(path, "utf8")) as StorageState;
  expect(saved.cookies.map((c) => c.name).sort()).toEqual(["a_sid", "b_sid"]);
});

test("a missing state reads as none; a torn or foreign one is ignored", async () => {
  const path = browserStatePath(workspace());
  expect(await readState(path)).toBeUndefined();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "{ not json");
  expect(await readState(path)).toBeUndefined();
  writeFileSync(path, '{"cookies": "nope"}');
  expect(await readState(path)).toBeUndefined();
});

test("a workspace that is gone is never recreated by a save", async () => {
  const gone = join(mkdtempSync(join(tmpdir(), "browser-state-")), "Agent");
  const h = holder(browserStatePath(gone), () => ({
    cookies: [cookie("sid", "abc")],
    origins: [],
  }));
  await saveState(h);
  expect(existsSync(gone)).toBe(false);
  expect(h.base).toEqual(EMPTY_STATE);
  // Nor is a workspace without `.houston/` given one.
  const bare = mkdtempSync(join(tmpdir(), "browser-state-"));
  await saveState(holder(browserStatePath(bare), () => EMPTY_STATE));
  expect(readdirSync(bare)).toEqual([]);
});
