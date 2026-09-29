import type { Routine } from "@houston/protocol";
import { docKey } from "./layout";
import {
  type DocDiagnostic,
  loadJson,
  saveJson,
  type TextStore,
} from "./store";

// The edit and run-history halves live beside this file; re-exported so
// "./routines" stays the one routine entry point.
export { applyRoutineUpdate, createRoutine } from "./routine-edit";
export {
  loadRoutineRuns,
  normalizeRoutineRuns,
  saveRoutineRuns,
} from "./routine-runs-doc";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A trigger binding is well-formed. Discriminated on `kind`:
 *  - `"webhook"` — an incoming-webhook wake. Valid iff `key_prefix` is absent or
 *    a string (display-only "wh_xxxxxxxx" label; the secret never lives here).
 *    No Composio fields are required — the gateway mints the URL out of band.
 *  - absent / `"composio"` — a Composio trigger. Valid iff it carries the two
 *    identifying strings and an object config. `connected_account_id` is optional
 *    (pinned only when the user has more than one account for the toolkit).
 *
 * A missing `kind` reads as Composio, so every pre-webhook binding validates
 * unchanged (no migration). Exported so the write path (routes) rejects a
 * malformed binding up front rather than persisting one that `normalizeRoutines`
 * would silently drop on the next read.
 */
export const isValidTriggerBinding = (v: unknown): boolean => {
  if (!isRecord(v)) return false;
  if (v.kind === "webhook") {
    return v.key_prefix === undefined || typeof v.key_prefix === "string";
  }
  return (
    typeof v.toolkit === "string" &&
    typeof v.trigger_slug === "string" &&
    isRecord(v.trigger_config)
  );
};

/**
 * Normalize raw routines: defaults per the schema; entries without identity or
 * without exactly one valid wake mechanism dropped + reported.
 *
 * FORWARD-COMPAT CONTRACT: this read is tolerant of trigger routines (a
 * `trigger` binding and no `schedule`) so that an engine build predating
 * event-driven routines does NOT erase them on the next write. Every save writes
 * back only the survivors, so a reader that dropped schedule-less entries would
 * silently delete a user's trigger automations. Rules: keep a routine with a
 * valid `trigger` and no schedule, keep the legacy schedule-only shape, and drop
 * (with a diagnostic) any entry that has BOTH or NEITHER, or whose `trigger` is
 * malformed. Beta policy: no silent loss — every drop surfaces a diagnostic.
 */
export function normalizeRoutines(
  raw: unknown,
  key: string,
): { items: Routine[]; diagnostics: DocDiagnostic[] } {
  if (raw === null || raw === undefined) return { items: [], diagnostics: [] };
  if (!Array.isArray(raw)) {
    return {
      items: [],
      diagnostics: [{ key, message: "routines.json is not an array" }],
    };
  }
  const items: Routine[] = [];
  const diagnostics: DocDiagnostic[] = [];
  const drop = (message: string, entry: unknown) =>
    diagnostics.push({
      key,
      message: `${message}: ${JSON.stringify(entry)?.slice(0, 120)}`,
    });
  for (const entry of raw) {
    if (
      !(
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        typeof entry.prompt === "string"
      )
    ) {
      drop("dropped malformed routine entry", entry);
      continue;
    }
    const hasSchedule = typeof entry.schedule === "string";
    const triggerPresent = entry.trigger != null;
    if (triggerPresent && !isValidTriggerBinding(entry.trigger)) {
      drop("dropped routine with malformed trigger", entry);
      continue;
    }
    // Exactly one wake mechanism. `hasSchedule === triggerPresent` is true when
    // both are set (ambiguous) or neither is (never fires) — both are invalid.
    if (hasSchedule === triggerPresent) {
      drop("dropped routine without exactly one of schedule/trigger", entry);
      continue;
    }
    // HOU-470 removed the per-routine `timezone` override (one account-wide
    // zone now) and HOU-725 removed `description` (display-only, nothing
    // consumed it). Routines written by older builds still carry the stray
    // keys on disk; drop them on read so they do not round-trip back out,
    // an idempotent no-migration cleanup (they disappear on next write).
    const item = {
      enabled: true,
      suppress_when_silent: false,
      chat_mode: entry.chat_mode === "per_run" ? "per_run" : "shared",
      integrations: Array.isArray(entry.integrations) ? entry.integrations : [],
      created_at: "",
      updated_at: "",
      ...entry,
    } as Routine & { timezone?: unknown; description?: unknown };
    delete item.timezone;
    delete item.description;
    // A trigger routine carries no schedule; a stray non-string schedule (e.g.
    // an explicit null) must not round-trip as an invalid wake field.
    if (!hasSchedule) delete item.schedule;
    items.push(item);
  }
  return { items, diagnostics };
}

export async function loadRoutines(
  store: TextStore,
  root: string,
): Promise<{ items: Routine[]; diagnostics: DocDiagnostic[] }> {
  const key = docKey(root, "routines");
  return normalizeRoutines(await loadJson<unknown>(store, key, []), key);
}

export async function saveRoutines(
  store: TextStore,
  root: string,
  items: Routine[],
): Promise<void> {
  await saveJson(store, docKey(root, "routines"), items);
}
