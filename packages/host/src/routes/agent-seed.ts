import { jsonDoc, parseJsonDoc } from "@houston/domain";
import type { Vfs } from "../vfs";

/**
 * Validate a seed's relative key: it must stay inside the agent root.
 *
 * Returns the key unchanged when safe, or `null` when it would escape the
 * root (absolute path, empty, backslashes, NUL, or any `.`/`..`/empty
 * segment). Seed maps are client-supplied on `POST /agents`, so a buggy or
 * hostile key must never let a write land outside `<root>/`.
 */
export function safeSeedKey(key: string): string | null {
  if (!key || key.startsWith("/") || key.includes("\0") || key.includes("\\")) {
    return null;
  }
  for (const seg of key.split("/")) {
    if (seg === "" || seg === "." || seg === "..") return null;
  }
  return key;
}

export interface AgentSeed {
  /** CLAUDE.md instructions, written verbatim to `<root>/CLAUDE.md`. */
  claudeMd?: string;
  /** Flat `relativePath → contents` map written verbatim under `<root>/`. */
  seeds?: Record<string, string>;
}

/**
 * The routines documents a client-supplied tree may carry, relative to the
 * agent root: the family file, and its flat pre-v0.4 twin that the boot layout
 * migration moves into place. Their entries carry per-routine acting identity
 * (`created_by`).
 */
const ROUTINE_DOC_KEYS: ReadonlySet<string> = new Set([
  ".houston/routines/routines.json",
  ".houston/routines.json",
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Stamp `created_by` on every routine of a client-supplied routines document
 * (seeds: builtin templates, portable installs; a migration import). A routine
 * fires as the user its `created_by` names, so the value is the server's to
 * set, never the body's: each entry takes the verified actor of the write, and
 * with no actor the field is dropped (the control-plane fire planner treats an
 * authorless routine as not fireable) rather than kept. The doc is read the way
 * every reader reads it (`parseJsonDoc`: a BOM or trailing bytes do not hide an
 * entry). A doc no reader can parse, or one that is not an array, holds no
 * routine and is stored verbatim: normalizeRoutines reports it on the first
 * read, and inventing structure here would mask that diagnostic.
 */
export function stampRoutineCreator(
  content: string,
  actor: string | undefined,
): string {
  let parsed: unknown;
  try {
    parsed = parseJsonDoc(content, "routines.json");
  } catch {
    return content;
  }
  if (!Array.isArray(parsed)) return content;
  const stamped = parsed.map((entry) => {
    if (!isRecord(entry)) return entry;
    const { created_by: _fromClient, ...routine } = entry;
    return actor ? { ...routine, created_by: actor } : routine;
  });
  return jsonDoc(stamped);
}

/**
 * An imported file's bytes as they are written: a routines document is client
 * input like a seed, so it is stamped the same way (stampRoutineCreator).
 */
export function importedFileBytes(
  rel: string,
  data: Uint8Array,
  actor: string | undefined,
): Buffer {
  const bytes = Buffer.from(data);
  if (!ROUTINE_DOC_KEYS.has(rel)) return bytes;
  return Buffer.from(stampRoutineCreator(bytes.toString("utf8"), actor));
}

/**
 * Write an agent's initial files under `root` in the vfs: its CLAUDE.md and a
 * flat map of seed files (skills at `.agents/skills/<slug>/SKILL.md`, seeded
 * `.houston` data, working files). This is the SAME `seeds` contract the wire
 * `CreateAgent` request carries and the Rust engine honored on install — the
 * host must write them too, or every non-AI agent (builtin templates, portable
 * installs) is created with no instructions and no skills.
 *
 * A key that would escape the agent root throws rather than being skipped: a
 * create that asked to seed and could not must fail loudly (beta policy — no
 * silent, half-provisioned agents).
 */
export async function writeAgentSeeds(
  vfs: Vfs,
  root: string,
  { claudeMd, seeds }: AgentSeed,
  // The verified acting identity of the create (C2), stamped as `created_by`
  // on every seeded routine — see stampRoutineCreator.
  routineCreatedBy?: string,
): Promise<void> {
  if (claudeMd !== undefined) {
    await vfs.writeText(`${root}/CLAUDE.md`, claudeMd);
  }
  for (const [key, content] of Object.entries(seeds ?? {})) {
    const safe = safeSeedKey(key);
    if (!safe) throw new Error(`unsafe seed path: ${key}`);
    const body = ROUTINE_DOC_KEYS.has(safe)
      ? stampRoutineCreator(content, routineCreatedBy)
      : content;
    await vfs.writeText(`${root}/${safe}`, body);
  }
}

/**
 * Narrow an untrusted JSON value to a `Record<string, string>` (the `seeds`
 * shape). Returns `null` when the value is not a plain object of string
 * values, so the caller can reject it with a 400 instead of writing garbage.
 */
export function asSeedRecord(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
}
