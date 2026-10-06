import { isDeepStrictEqual } from "node:util";
import { docKey, loadRoutines, normalizeRoutines } from "@houston/domain";
import type { Vfs } from "../vfs";
import { type PlanFloorRefusal, planFloorRefusal } from "./routine-write-gates";

/** The routines document, as the raw agent-file route addresses it. */
const ROUTINES_DOCUMENT = docKey("", "routines").slice(1);

/**
 * The plan-floor refusal a raw write of the routines document earns, or null.
 * The agent-file route replaces the whole document, so each routine in it that
 * is new or differs from the stored one is judged as a routine write would be
 * (routine-write.ts): a disabled routine never fires and a trigger has no
 * cadence, so both pass; an untouched routine passes whatever its schedule. A
 * document that does not parse is not judged: the write itself is unchanged.
 */
export async function routinesDocFloorRefusal(
  vfs: Vfs,
  root: string,
  rel: string,
  content: string,
  floor: number | undefined,
): Promise<PlanFloorRefusal | null> {
  if (floor === undefined || rel !== ROUTINES_DOCUMENT) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  const written = normalizeRoutines(raw, ROUTINES_DOCUMENT).items;
  const { items: stored } = await loadRoutines(vfs, root);
  for (const next of written) {
    const current = stored.find((routine) => routine.id === next.id);
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
