import {
  type HoustonFamily,
  normalizeActivities,
  normalizeLearnings,
  normalizeRoutineRuns,
  normalizeRoutines,
  parseJsonDoc,
} from "@houston/domain";

/** Leaf module: a family file's doc, shared by op republish and the migrate
 *  op's projection. */

const emptyDoc = (family: HoustonFamily) => (family === "config" ? {} : []);

/** A family file's doc as the pod's projector derives it (the same tolerant
 *  parse as its reads): an absent file projects the empty doc, a file no
 *  salvage can read projects nothing (undefined), never an empty doc over
 *  the one it had. */
export function familyDoc(
  family: HoustonFamily,
  raw: string | null,
  key: string,
): unknown {
  if (raw === null) return emptyDoc(family);
  let parsed: unknown;
  try {
    parsed = parseJsonDoc(raw, key);
  } catch {
    return undefined;
  }
  return normalizeFamily(family, parsed, key);
}

function normalizeFamily(
  family: HoustonFamily,
  parsed: unknown,
  key: string,
): unknown {
  switch (family) {
    case "activity":
      return normalizeActivities(parsed, key).items;
    case "routines":
      return normalizeRoutines(parsed, key).items;
    case "routine_runs":
      return normalizeRoutineRuns(parsed, key).items;
    case "learnings":
      return normalizeLearnings(parsed, key).items;
    case "config":
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? parsed
        : {};
    default:
      return parsed;
  }
}
