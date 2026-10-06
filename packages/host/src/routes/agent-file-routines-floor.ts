import { isDeepStrictEqual } from "node:util";
import { docKey, normalizeRoutines, parseJsonDoc } from "@houston/domain";
import type { Routine } from "@houston/protocol";
import type { Vfs } from "../vfs";
import { type PlanFloorRefusal, planFloorRefusal } from "./routine-write-gates";

/** The routines document, as the raw agent-file route addresses it. */
const ROUTINES_DOCUMENT = docKey("", "routines").slice(1);

/**
 * The plan-floor refusal a raw write of the routines document earns, or null.
 * The agent-file route replaces the whole document, so each routine in it that
 * is new or differs from the stored one is judged as a routine write would be
 * (routine-write.ts): a disabled routine never fires and a trigger has no
 * cadence, so both pass; an untouched routine passes whatever its schedule.
 * Both documents are read the way every reader reads them (`parseJsonDoc`: a
 * BOM, trailing bytes or a raw newline do not hide a routine). A written
 * document that still does not parse is not judged: the write is unchanged.
 */
export async function routinesDocFloorRefusal(
  vfs: Vfs,
  root: string,
  rel: string,
  content: string,
  floor: number | undefined,
): Promise<PlanFloorRefusal | null> {
  if (floor === undefined || rel !== ROUTINES_DOCUMENT) return null;
  const written = parsedRoutines(content);
  if (!written) return null;
  const stored = parsedRoutines(await vfs.readText(docKey(root, "routines")));
  if (stored === null)
    // A corrupt stored doc has no routine to compare with: every written one
    // is judged as new, and the write that repairs the file still goes through.
    console.warn(`[routines] stored ${ROUTINES_DOCUMENT} is unreadable`);
  for (const next of written) {
    const current = stored?.find((routine) => routine.id === next.id);
    if (next.enabled === false || isDeepStrictEqual(current, next)) continue;
    const refusal = planFloorRefusal(
      next.schedule,
      floor,
      current?.schedule === next.schedule,
    );
    if (refusal) return refusal;
  }
  return null;
}

/** The routines in a document's text, or null when it is not JSON at all. */
function parsedRoutines(text: string | null): Routine[] | null {
  if (text === null) return [];
  let raw: unknown;
  try {
    raw = parseJsonDoc(text, ROUTINES_DOCUMENT);
  } catch {
    // Unparseable even after salvage: the caller decides what that means.
    return null;
  }
  return normalizeRoutines(raw, ROUTINES_DOCUMENT).items;
}
