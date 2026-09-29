import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  CLAUDE_GLOBAL_CONFIG,
  parseClaudeFlagCache,
  readClaudeConfigFlags,
  readClaudeFlagCacheFile,
  sameClaudeFlags,
  seedClaudeConfigFlags,
} from "./flag-cache";

const cache = {
  cachedGrowthBookFeatures: { tengu_a: true, tengu_b: { n: 1 } },
  cachedGrowthBookFeaturesAt: 1_790_000_000_000,
  cachedExperimentFeatures: ["tengu_a"],
  cachedExperimentData: { tengu_a: { experimentId: "e", variationId: 1 } },
};

test("reads the cache out of a full CLI config, and nothing else", () => {
  expect(
    parseClaudeFlagCache({ ...cache, userID: "anon", numStartups: 3 }),
  ).toEqual(cache);
  expect(
    parseClaudeFlagCache({ cachedGrowthBookFeatures: { tengu_a: false } }),
  ).toEqual({ cachedGrowthBookFeatures: { tengu_a: false } });
});

test("a malformed or empty cache is no cache", () => {
  for (const value of [
    null,
    [],
    "cache",
    {},
    { cachedGrowthBookFeatures: {} },
    { cachedGrowthBookFeatures: [] },
    { ...cache, cachedGrowthBookFeaturesAt: "yesterday" },
    { ...cache, cachedExperimentFeatures: [1] },
    { ...cache, cachedExperimentData: [] },
  ])
    expect(parseClaudeFlagCache(value)).toBeUndefined();
});

test("a corrupt stored cache is ignored and reported; an absent one is quiet", () => {
  const dir = mkdtempSync(join(tmpdir(), "flag-cache-"));
  const reasons: string[] = [];
  const path = join(dir, "cache.json");
  expect(readClaudeFlagCacheFile(path, (r) => reasons.push(r))).toBeUndefined();
  expect(reasons).toEqual([]);
  writeFileSync(path, "{not json");
  expect(readClaudeFlagCacheFile(path, (r) => reasons.push(r))).toBeUndefined();
  writeFileSync(path, JSON.stringify({ cachedGrowthBookFeatures: {} }));
  expect(readClaudeFlagCacheFile(path, (r) => reasons.push(r))).toBeUndefined();
  expect(reasons).toHaveLength(2);
  writeFileSync(path, JSON.stringify(cache));
  expect(readClaudeFlagCacheFile(path, (r) => reasons.push(r))).toEqual(cache);
});

test("a CLI config with no flags yet is normal, not corrupt", () => {
  const dir = mkdtempSync(join(tmpdir(), "flag-cache-"));
  const reasons: string[] = [];
  writeFileSync(
    join(dir, CLAUDE_GLOBAL_CONFIG),
    JSON.stringify({ cachedGrowthBookFeatures: {}, numStartups: 1 }),
  );
  expect(readClaudeConfigFlags(dir, (r) => reasons.push(r))).toBeUndefined();
  expect(reasons).toEqual([]);
});

test("seeds a new config dir, never over the CLI's own config", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "flag-cache-")), "claude");
  expect(seedClaudeConfigFlags(dir, cache)).toBe(true);
  const path = join(dir, CLAUDE_GLOBAL_CONFIG);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(cache);
  writeFileSync(path, JSON.stringify({ numStartups: 9 }));
  expect(seedClaudeConfigFlags(dir, cache)).toBe(false);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ numStartups: 9 });
});

test("the same flags compare equal regardless of key order or fetch time", () => {
  const reordered = {
    cachedGrowthBookFeatures: { tengu_b: { n: 1 }, tengu_a: true },
    cachedGrowthBookFeaturesAt: 1,
    cachedExperimentFeatures: ["tengu_a"],
    cachedExperimentData: { tengu_a: { variationId: 1, experimentId: "e" } },
  };
  expect(sameClaudeFlags(cache, reordered)).toBe(true);
  expect(
    sameClaudeFlags(cache, {
      ...cache,
      cachedGrowthBookFeatures: { tengu_a: false, tengu_b: { n: 1 } },
    }),
  ).toBe(false);
});
