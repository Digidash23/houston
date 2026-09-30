import { ACTIVITY_DOC, mergeActivityArrays } from "./activity-merge";
import {
  mergeRoutineRunArrays,
  ROUTINE_RUNS_DOC,
  ROUTINE_RUNS_MERGE_ROUNDS,
} from "./routine-runs-merge";

const ROUTINES_DOC = ".houston/routines/routines.json";
const LEARNINGS_DOC = ".houston/learnings/learnings.json";
const CUSTOM_DEFINITIONS = "custom-integrations.json";

function isPath(relativePath: string, documentPath: string): boolean {
  return (
    relativePath === documentPath || relativePath.endsWith(`/${documentPath}`)
  );
}

/** Documents sync-back merges on a generation conflict instead of overwriting. */
export function isMergedDocument(relativePath: string): boolean {
  return (
    arrayIdentity(relativePath) !== undefined ||
    isPath(relativePath, ACTIVITY_DOC) ||
    isPath(relativePath, ROUTINE_RUNS_DOC) ||
    relativePath === CUSTOM_DEFINITIONS
  );
}

/** Refresh+merge+upload rounds a merged document gets after its first 412. */
export const MERGE_UPLOAD_ATTEMPTS = 6;

/** The merge rounds `relativePath` gets: its own budget, else the default. */
export function mergeUploadRounds(relativePath: string): number {
  return isPath(relativePath, ROUTINE_RUNS_DOC)
    ? ROUTINE_RUNS_MERGE_ROUNDS
    : MERGE_UPLOAD_ATTEMPTS;
}

/**
 * Documents the standing store sync merges once on a generation conflict:
 * never the board, which a standing pod re-uploads over the refreshed
 * generation. The run history merges so a run a sandbox landed survives.
 */
export function mergesOnceOnConflict(relativePath: string): boolean {
  return (
    arrayIdentity(relativePath) !== undefined ||
    isPath(relativePath, ROUTINE_RUNS_DOC) ||
    relativePath === CUSTOM_DEFINITIONS
  );
}

/** Documents whose hydrated bytes are kept as the base of a three-way merge. */
export function keepsMergeBase(relativePath: string): boolean {
  return isPath(relativePath, ACTIVITY_DOC);
}

function parseBase(baseBody: string | undefined): unknown[] | undefined {
  if (baseBody === undefined) return undefined;
  try {
    const base = JSON.parse(baseBody) as unknown;
    return Array.isArray(base) ? base : undefined;
  } catch {
    // An unparseable base only costs the three-way precision: the two-way
    // merge still keeps every card either side holds.
    return undefined;
  }
}

function arrayIdentity(relativePath: string): string | undefined {
  return isPath(relativePath, ROUTINES_DOC) ||
    isPath(relativePath, LEARNINGS_DOC)
    ? "id"
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identity(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[field];
  return typeof candidate === "string" ? candidate : undefined;
}

function objectDocument(value: unknown, relativePath: string) {
  if (!isRecord(value)) {
    throw new Error(`${relativePath} is not an object`);
  }
  return value;
}

function mergeArrayDocument(
  remote: unknown,
  local: unknown,
  field: string,
  relativePath: string,
): unknown[] {
  if (!Array.isArray(remote) || !Array.isArray(local)) {
    throw new Error(`${relativePath} is not an array`);
  }
  const localIds = new Set(
    local.map((item) => identity(item, field)).filter((id) => id !== undefined),
  );
  return [
    ...remote.filter((item) => {
      const id = identity(item, field);
      return id === undefined || !localIds.has(id);
    }),
    ...local,
  ];
}

/**
 * Merge local document entries into a refreshed remote document. `baseBody`
 * (the bytes this writer started from) makes the activity merge three-way.
 */
export function mergeDocumentBodies(
  relativePath: string,
  localBody: string,
  remoteBody: string,
  baseBody?: string,
): string | undefined {
  if (!isMergedDocument(relativePath)) return undefined;
  const field = arrayIdentity(relativePath);
  const remote = JSON.parse(remoteBody) as unknown;
  const local = JSON.parse(localBody) as unknown;
  if (isPath(relativePath, ACTIVITY_DOC)) {
    if (!Array.isArray(remote) || !Array.isArray(local)) {
      throw new Error(`${relativePath} is not an array`);
    }
    const merged = mergeActivityArrays(remote, local, parseBase(baseBody));
    return `${JSON.stringify(merged, null, 2)}\n`;
  }
  if (isPath(relativePath, ROUTINE_RUNS_DOC)) {
    if (!Array.isArray(remote) || !Array.isArray(local)) {
      throw new Error(`${relativePath} is not an array`);
    }
    return `${JSON.stringify(mergeRoutineRunArrays(remote, local), null, 2)}\n`;
  }
  if (field) {
    const merged = mergeArrayDocument(remote, local, field, relativePath);
    return `${JSON.stringify(merged, null, 2)}\n`;
  }
  const remoteShape = objectDocument(remote, relativePath);
  const localShape = objectDocument(local, relativePath);
  if (remoteShape.version !== 1 || localShape.version !== 1) {
    throw new Error(`${relativePath} has an unsupported version`);
  }
  const merged = {
    ...remoteShape,
    ...localShape,
    items: mergeArrayDocument(
      remoteShape.items,
      localShape.items,
      "slug",
      relativePath,
    ),
  };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

function cardIds(body: string): string[] {
  try {
    const doc = JSON.parse(body) as unknown;
    return Array.isArray(doc)
      ? doc.map((card) => identity(card, "id")).filter((id) => id !== undefined)
      : [];
  } catch {
    return [];
  }
}

/**
 * Board card ids `remoteBody` holds that `mergedBody` does not: what a merge
 * removed from the board it landed over. Empty for every other document.
 */
export function removedCardIds(
  relativePath: string,
  remoteBody: string,
  mergedBody: string,
): string[] {
  if (!isPath(relativePath, ACTIVITY_DOC)) return [];
  const kept = new Set(cardIds(mergedBody));
  return cardIds(remoteBody).filter((id) => !kept.has(id));
}
