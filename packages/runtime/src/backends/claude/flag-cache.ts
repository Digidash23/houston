import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { atomicTempPath } from "@houston/protocol";

/**
 * The Claude Code CLI's feature-flag (GrowthBook) cache, as it keeps it in
 * `<CLAUDE_CONFIG_DIR>/.claude.json`.
 *
 * With that cache empty the CLI blocks startup on a GrowthBook fetch before it
 * can run anything; with it present the CLI starts on the cached values and
 * refreshes them in the background, which is what happens on a laptop after
 * the first run. A turn whose config dir is new every time pays that fetch on
 * every turn, so the turn carries the cache in and out (turn/turn-claude-flags).
 *
 * The values are evaluated for the signed-in account, so a cache belongs to
 * exactly one person and is never handed to anyone else.
 */
export interface ClaudeFlagCache {
  cachedGrowthBookFeatures: Record<string, unknown>;
  cachedGrowthBookFeaturesAt?: number;
  cachedExperimentFeatures?: string[];
  cachedExperimentData?: Record<string, unknown>;
}

/** The CLI's global config file inside its config dir (prod OAuth: no suffix). */
export const CLAUDE_GLOBAL_CONFIG = ".claude.json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The cache in a parsed `.claude.json` (or a stored copy of one), or
 * undefined when there is none or any part of it is malformed. An empty
 * feature map is no cache at all: seeding it would not spare the fetch.
 */
export function parseClaudeFlagCache(
  value: unknown,
): ClaudeFlagCache | undefined {
  if (!isRecord(value)) return undefined;
  const features = value.cachedGrowthBookFeatures;
  if (!isRecord(features) || Object.keys(features).length === 0)
    return undefined;
  const at = value.cachedGrowthBookFeaturesAt;
  const experiments = value.cachedExperimentFeatures;
  const experimentData = value.cachedExperimentData;
  if (at !== undefined && (typeof at !== "number" || !Number.isFinite(at)))
    return undefined;
  if (
    experiments !== undefined &&
    (!Array.isArray(experiments) ||
      !experiments.every((key) => typeof key === "string"))
  )
    return undefined;
  if (experimentData !== undefined && !isRecord(experimentData))
    return undefined;
  return {
    cachedGrowthBookFeatures: features,
    ...(at !== undefined ? { cachedGrowthBookFeaturesAt: at } : {}),
    ...(experiments !== undefined
      ? { cachedExperimentFeatures: experiments as string[] }
      : {}),
    ...(experimentData !== undefined
      ? { cachedExperimentData: experimentData }
      : {}),
  };
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** A JSON file's value; absent is undefined, unreadable/invalid is reported. */
function readJson(
  path: string,
  onCorrupt: (reason: string) => void,
): unknown | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      onCorrupt(reason(error));
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    onCorrupt(reason(error));
    return undefined;
  }
}

/**
 * A stored flag cache. Absent reads as undefined; anything else that is not a
 * cache does too, with `onCorrupt` told why: a corrupt cache only ever costs
 * the one blocking fetch it was meant to spare.
 */
export function readClaudeFlagCacheFile(
  path: string,
  onCorrupt: (reason: string) => void,
): ClaudeFlagCache | undefined {
  const value = readJson(path, onCorrupt);
  if (value === undefined) return undefined;
  const cache = parseClaudeFlagCache(value);
  if (!cache) onCorrupt("not a feature-flag cache");
  return cache;
}

/**
 * The cache the CLI left in a config dir. A config without one is normal (the
 * CLI had not fetched its flags yet), so only an unreadable file is reported.
 */
export function readClaudeConfigFlags(
  configDir: string,
  onCorrupt: (reason: string) => void,
): ClaudeFlagCache | undefined {
  return parseClaudeFlagCache(
    readJson(join(configDir, CLAUDE_GLOBAL_CONFIG), onCorrupt),
  );
}

/** Atomically write a flag cache as a JSON file (the CLI's own key names). */
export function writeClaudeFlagCacheFile(
  path: string,
  cache: ClaudeFlagCache,
): void {
  const tmp = atomicTempPath(path);
  writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Give a config dir the cache before the CLI starts. Only a config dir with
 * no `.claude.json` yet: an existing one is the CLI's own state, and it may
 * already hold a newer cache than the one offered.
 */
export function seedClaudeConfigFlags(
  configDir: string,
  cache: ClaudeFlagCache,
): boolean {
  const path = join(configDir, CLAUDE_GLOBAL_CONFIG);
  if (existsSync(path)) return false;
  mkdirSync(configDir, { recursive: true });
  writeClaudeFlagCacheFile(path, cache);
  return true;
}

/** JSON with object keys sorted, so equal values compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Whether two caches carry the same flag values (the fetch time aside). */
export function sameClaudeFlags(a: ClaudeFlagCache, b: ClaudeFlagCache) {
  return (
    canonical([
      a.cachedGrowthBookFeatures,
      a.cachedExperimentFeatures,
      a.cachedExperimentData,
    ]) ===
    canonical([
      b.cachedGrowthBookFeatures,
      b.cachedExperimentFeatures,
      b.cachedExperimentData,
    ])
  );
}
