import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BrowserContext } from "playwright-core";
import { expect, test } from "vitest";
import { browserStatePath, readableState, saveState } from "./state-store";

const workspace = () => mkdtempSync(join(tmpdir(), "browser-state-"));

test("sign-ins live in the agent's .houston/browser/state.json", () => {
  expect(browserStatePath("/ws/Agent")).toBe(
    "/ws/Agent/.houston/browser/state.json",
  );
});

test("saving writes the context's storage state atomically, owner-only", async () => {
  const path = browserStatePath(workspace());
  const state = { cookies: [{ name: "sid", value: "abc" }], origins: [] };
  const asked: unknown[] = [];
  // SAFETY: saveState reads only storageState from the context.
  const context = {
    storageState: async (options: unknown) => {
      asked.push(options);
      return state;
    },
  } as unknown as BrowserContext;
  await saveState(context, path);
  expect(asked).toEqual([{ indexedDB: true }]);
  expect(await readableState(path)).toBe(path);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  // No half-written scratch file is left for the store sync to find.
  expect(readdirSync(dirname(path))).toEqual(["state.json"]);
});

test("a missing state reads as none; a torn one is ignored, not fatal", async () => {
  const path = browserStatePath(workspace());
  expect(await readableState(path)).toBeUndefined();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "{ not json");
  expect(await readableState(path)).toBeUndefined();
});
