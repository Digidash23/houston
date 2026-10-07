import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalDirStore,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import { expect, test } from "vitest";
import { startTurnRequestFilesystem } from "./turn-claimed-hydration";
import { syncTurnFilesystem } from "./turn-filesystem";

const PREFIX = "ws/w1/agent-1";
const CLAIM = {
  id: "claim-1",
  token: "token-1",
  bootId: "boot-1",
  heartbeatUrl: "https://heartbeat.test",
};

/** A store holding an agent with runtime inputs and the person's own files. */
function agentStore() {
  const storeRoot = mkdtempSync(join(tmpdir(), "deferred-scope-store-"));
  const agent = join(storeRoot, PREFIX, "workspaces", "Personal", "Bob");
  for (const dir of [
    [".houston", "runtime"],
    [".agents", "skills", "brief"],
    ["reports"],
    ["uploads"],
  ])
    mkdirSync(join(agent, ...dir), { recursive: true });
  writeFileSync(join(agent, "CLAUDE.md"), "# Bob\n");
  writeFileSync(join(agent, "notes.md"), "root note\n");
  writeFileSync(join(agent, ".houston", "runtime", "settings.json"), "{}");
  writeFileSync(join(agent, ".agents", "skills", "brief", "SKILL.md"), "s\n");
  writeFileSync(join(agent, "reports", "q3.md"), "q3 v1\n");
  writeFileSync(join(agent, "reports", "q4.md"), "q4 v1\n");
  writeFileSync(join(agent, "uploads", "photo.png"), "png");
  return { storeRoot, agent, inner: new LocalDirStore(storeRoot) };
}

function gatedStore(
  inner: LocalDirStore,
  hold: (key: string) => Promise<void> | undefined,
): ObjectStore {
  return {
    list: (p) => inner.list(p),
    manifest: (p) => inner.manifest(p),
    download: async (key, destination, options) => {
      await hold(key);
      await inner.download(key, destination, options);
    },
    upload: (source, key, options) => inner.upload(source, key, options),
    delete: (key, options) => inner.delete(key, options),
  };
}

function prepare(store: ObjectStore) {
  return startTurnRequestFilesystem({
    store,
    prefix: PREFIX,
    root: mkdtempSync(join(tmpdir(), "deferred-scope-root-")),
    turn: { claim: CLAIM, conversationId: "c1" },
    timings: {},
  });
}

test("the prompt's inputs land before `hydrated`, the person's folders after", async () => {
  const { agent, inner } = agentStore();
  let release: () => void = () => undefined;
  const landing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = gatedStore(inner, (key) =>
    key.includes("/reports/") || key.includes("/uploads/")
      ? landing
      : undefined,
  );
  const preparation = await prepare(store);
  const fs = await preparation.hydrated;
  const at = (...rel: string[]) => join(fs.workspaceDir, ...rel);
  expect(existsSync(at("CLAUDE.md"))).toBe(true);
  expect(existsSync(at("notes.md"))).toBe(true);
  expect(existsSync(at(".houston", "runtime", "settings.json"))).toBe(true);
  expect(existsSync(at(".agents", "skills", "brief", "SKILL.md"))).toBe(true);
  expect(existsSync(at("reports", "q3.md"))).toBe(false);
  expect(existsSync(at("uploads", "photo.png"))).toBe(false);

  release();
  await fs.workspaceReady;
  // A tool runs only now (the gate): it edits one file and makes another.
  writeFileSync(at("reports", "q3.md"), "q3 v2\n");
  writeFileSync(at("reports", "summary.md"), "made by the turn\n");
  const synced = await syncTurnFilesystem({
    store: inner,
    prefix: PREFIX,
    filesystem: fs,
    conversationId: "c1",
    claimed: true,
  });
  expect(synced.uploaded.toSorted()).toEqual([
    "workspaces/Personal/Bob/reports/q3.md",
    "workspaces/Personal/Bob/reports/summary.md",
  ]);
  expect(synced.deleted).toEqual([]);
  expect(readFileSync(join(agent, "reports", "q3.md"), "utf8")).toBe("q3 v2\n");
  expect(await preparation.settled).toMatchObject({ ok: true });
});

test("a failed deferral never deletes or overwrites the person's files", async () => {
  const { agent, inner } = agentStore();
  const store = gatedStore(inner, (key) =>
    key.endsWith("/reports/q4.md")
      ? Promise.reject(new Error("store unreachable"))
      : undefined,
  );
  const preparation = await prepare(store);
  const fs = await preparation.hydrated;
  await expect(fs.workspaceReady).rejects.toThrow(/store unreachable/);
  const synced = await syncTurnFilesystem({
    store: inner,
    prefix: PREFIX,
    filesystem: fs,
    conversationId: "c1",
    claimed: true,
  });
  expect(synced.uploaded).toEqual([]);
  expect(synced.deleted).toEqual([]);
  expect(readFileSync(join(agent, "reports", "q4.md"), "utf8")).toBe("q4 v1\n");
  expect(await preparation.settled).toMatchObject({ ok: false });
});
