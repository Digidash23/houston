import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenUsage } from "@houston/runtime-client";
import {
  LocalDirStore,
  type ObjectStore,
  StoreConflictError,
  StoreFencedError,
} from "@houston/runtime-client/object-sync";
import { beforeEach, expect, test, vi } from "vitest";
import { recordPooledTokenSpend } from "./turn-ledger";

/**
 * The token-spend ledger a standing pod folds every turn into
 * (`<agent>/.houston/runtime/token-usage.json`, ai/usage/ledger.ts), written
 * by a pooled turn into the same stored object. Two conversations of one
 * agent can run pooled at once, so the write is a generation-guarded
 * read-fold-write: a concurrent turn's spend is folded in, never lost or
 * counted twice.
 */

const DATA_REL = "workspaces/Personal/Bob/.houston/runtime";
const KEY = `${DATA_REL}/token-usage.json`;
const usage = (context: number, output: number): TokenUsage => ({
  context_tokens: context,
  output_tokens: output,
  cached_tokens: 0,
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

function storedLedger(root: string) {
  return JSON.parse(readFileSync(join(root, ...KEY.split("/")), "utf8")) as {
    providers: Record<
      string,
      { inputTokens: number; outputTokens: number; turns: number }
    >;
  };
}

const scratch = () => mkdtempSync(join(tmpdir(), "ledger-scratch-"));

test("each pooled turn folds its spend into the agent's stored ledger", async () => {
  const root = mkdtempSync(join(tmpdir(), "ledger-store-"));
  const store = new LocalDirStore(root);
  const base = { store, prefix: "", dataRel: DATA_REL, scratchDir: scratch() };

  await recordPooledTokenSpend({
    ...base,
    provider: "google",
    usage: usage(1_000, 50),
  });
  await recordPooledTokenSpend({
    ...base,
    provider: "google",
    usage: usage(3_000, 70),
  });
  await recordPooledTokenSpend({
    ...base,
    provider: "deepseek",
    usage: usage(10, 1),
  });

  const ledger = storedLedger(root);
  expect(ledger.providers.google).toMatchObject({
    inputTokens: 4_000,
    outputTokens: 120,
    turns: 2,
  });
  expect(ledger.providers.deepseek?.turns).toBe(1);
});

/** A store whose object changes under the first conditional write. */
function racingStore(root: string): ObjectStore & { uploads: string[] } {
  const inner = new LocalDirStore(root);
  let generation = 1;
  let raced = false;
  const uploads: string[] = [];
  return {
    uploads,
    list: (prefix) => inner.list(prefix),
    download: (key, dest) => inner.download(key, dest),
    async downloadVersioned(key, dest) {
      await inner.download(key, dest);
      return { generation: String(generation) };
    },
    async upload(src, key, opts) {
      uploads.push(opts?.ifGenerationMatch ?? "none");
      if (!raced) {
        raced = true;
        // Another conversation's turn lands its spend first.
        await recordPooledTokenSpend({
          store: inner,
          prefix: "",
          dataRel: DATA_REL,
          provider: "google",
          usage: usage(500, 5),
          scratchDir: scratch(),
        });
        generation++;
        throw new StoreConflictError(key, "precondition failed (412)");
      }
      await inner.upload(src, key);
      generation++;
      return { generation: String(generation) };
    },
    delete: (key) => inner.delete(key),
  };
}

test("a concurrent turn's spend is folded in, not overwritten", async () => {
  const root = mkdtempSync(join(tmpdir(), "ledger-race-"));
  const store = racingStore(root);

  await recordPooledTokenSpend({
    store,
    prefix: "",
    dataRel: DATA_REL,
    provider: "google",
    usage: usage(1_000, 50),
    scratchDir: scratch(),
  });

  // The retry re-read the newer object and wrote against its generation.
  expect(store.uploads).toEqual(["0", "2"]);
  expect(storedLedger(root).providers.google).toMatchObject({
    inputTokens: 1_500,
    outputTokens: 55,
    turns: 2,
  });
});

test("a fenced claim records nothing and never fails the turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "ledger-fenced-"));
  const inner = new LocalDirStore(root);
  const upload = vi.fn(async (_src: string, key: string) => {
    throw new StoreFencedError(key, "claim token stale (409)");
  });
  const store: ObjectStore = {
    list: (prefix) => inner.list(prefix),
    download: (key, dest) => inner.download(key, dest),
    upload,
    delete: (key) => inner.delete(key),
  };

  await expect(
    recordPooledTokenSpend({
      store,
      prefix: "",
      dataRel: DATA_REL,
      provider: "google",
      usage: usage(1_000, 50),
      scratchDir: scratch(),
    }),
  ).resolves.toBeUndefined();
  // A fenced worker's turn belongs to whoever adopted it: one try, no retry.
  expect(upload).toHaveBeenCalledTimes(1);
});

test("a stalled store costs the ledger entry, never the finished turn", async () => {
  const store: ObjectStore = {
    list: async () => [],
    download: () => new Promise(() => undefined),
    downloadVersioned: () => new Promise(() => undefined),
    upload: async () => undefined,
    delete: async () => undefined,
  };
  const started = Date.now();

  await recordPooledTokenSpend({
    store,
    prefix: "",
    dataRel: DATA_REL,
    provider: "google",
    usage: usage(1_000, 50),
    scratchDir: scratch(),
    deadlineMs: 50,
  });

  expect(Date.now() - started).toBeLessThan(2_000);
});

test("a scratch dir that cannot be made never fails the turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "ledger-noscratch-"));
  await expect(
    recordPooledTokenSpend({
      store: new LocalDirStore(root),
      prefix: "",
      dataRel: DATA_REL,
      provider: "google",
      usage: usage(1_000, 50),
      scratchDir: join(root, "missing", "dir"),
    }),
  ).resolves.toBeUndefined();
});

test("a read the store releases after the deadline never turns into a write", async () => {
  const upload = vi.fn(async () => undefined);
  const store: ObjectStore = {
    list: async () => [],
    download: async () => undefined,
    // A store that ignores cancellation and answers late.
    downloadVersioned: () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ generation: "3" }), 60),
      ),
    upload,
    delete: async () => undefined,
  };
  const scratchDir = scratch();

  await recordPooledTokenSpend({
    store,
    prefix: "",
    dataRel: DATA_REL,
    provider: "google",
    usage: usage(1_000, 50),
    scratchDir,
    deadlineMs: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));

  expect(upload).not.toHaveBeenCalled();
  // Its working copy went once the late read was done with it.
  expect(readdirSync(scratchDir)).toEqual([]);
});
