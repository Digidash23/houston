import { FilePathError, safeRel } from "../turn/files-path";

/**
 * The internal documents this route serves, listed because the alternative is
 * serving the agent's whole state directory.
 *
 * On the LOCAL layout the runtime's data directory lives INSIDE the agent root
 * (`paths.ts`: `<Workspace>/<Agent>/.houston/runtime`), so a route that clamped
 * traversal alone handed out `auth.json` (the OAuth access + refresh tokens),
 * the served-providers manifest, `settings.json` and every stored transcript to
 * anything that could address it — the Files tab's own rule (no top-level
 * dot-directory, `turn/files-path.ts`) exists for exactly this reason.
 *
 * So the visible working tree is admitted by that same rule, and the documents
 * the app genuinely keeps under dot-directories are named one by one: the
 * families the board, settings and memory panes read/write, plus the skill
 * files the skills panes save. Everything else under a dot-directory answers
 * 403 — including anything added to `.houston/runtime` later, which is the
 * point of listing what is allowed rather than what is not.
 */
const INTERNAL_DOCUMENT_PREFIXES: readonly string[] = [
  ".houston/activity/",
  ".houston/config/",
  ".houston/learnings/",
  ".houston/routines/",
  ".houston/routine_runs/",
  ".houston/skills/",
  ".agents/skills/",
  ".claude/skills/",
];

/**
 * True when `rel` is a document this route serves: an ordinary file in the
 * agent's visible working tree (the Files tab's own predicate, reused rather
 * than restated) or one of the named internal documents above.
 */
export function isServedDocument(rel: string): boolean {
  try {
    safeRel(rel);
    return true;
  } catch (error) {
    if (!(error instanceof FilePathError)) throw error;
    return INTERNAL_DOCUMENT_PREFIXES.some((prefix) => rel.startsWith(prefix));
  }
}
