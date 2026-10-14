import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalDirStore,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import { afterEach, expect, test, vi } from "vitest";
import { startTurnRequestFilesystem } from "./turn-claimed-hydration";
import { cleanupTurn } from "./turn-cleanup";
import { DeferredFilesAbandonedError } from "./turn-deferred-watch";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function temp(name: string) {
  const dir = mkdtempSync(join(tmpdir(), name));
  dirs.push(dir);
  return dir;
}

test("cleaning up a turn that never prompted abandons its deferred files quietly", async () => {
  const storeRoot = temp("cleanup-deferred-store-");
  const prefix = "ws/w1/agent-1";
  const agent = join(storeRoot, prefix, "workspaces", "Personal", "Bob");
  mkdirSync(join(agent, ".houston", "runtime"), { recursive: true });
  mkdirSync(join(agent, ".repo-web"), { recursive: true });
  writeFileSync(join(agent, ".houston", "runtime", "settings.json"), "{}");
  writeFileSync(join(agent, ".repo-web", "README.md"), "readme");
  const inner = new LocalDirStore(storeRoot);
  const stalled: ObjectStore = {
    list: (p) => inner.list(p),
    manifest: (p) => inner.manifest(p),
    download: async (key, destination, options) => {
      if (key.includes("/.repo-web/"))
        await new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(options.signal?.reason),
          ),
        );
      await inner.download(key, destination, options);
    },
    upload: (source, key, options) => inner.upload(source, key, options),
    delete: (key, options) => inner.delete(key, options),
  };
  const root = temp("cleanup-deferred-root-");
  const preparation = await startTurnRequestFilesystem({
    store: stalled,
    prefix,
    root,
    turn: {
      claim: {
        id: "claim-1",
        token: "token-1",
        bootId: "boot-1",
        heartbeatUrl: "https://heartbeat.test",
      },
      conversationId: "c1",
    },
    timings: {},
  });
  await preparation.hydrated;
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await cleanupTurn({
    root,
    scope: "Personal/Bob",
    conversationId: "c1",
    heartbeat: null,
    sandbox: null,
    hydration: preparation,
  });
  await expect(preparation.filesystem.workspaceReady).rejects.toBeInstanceOf(
    DeferredFilesAbandonedError,
  );
  expect(errors).not.toHaveBeenCalledWith(
    expect.stringContaining("deferred_files_failed"),
  );
});
