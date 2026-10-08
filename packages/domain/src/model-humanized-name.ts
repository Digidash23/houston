/**
 * The readable name Houston derives from a model id no one curated. Split from
 * `model-display-names.ts`, which re-exports it, so the curated table can grow.
 *
 * A dependency-free LEAF, exposed as the `@houston/domain/model-humanized-name`
 * subpath (see `provider-dialect.ts`).
 */

/** Words that read as shouted, not title-cased. */
const ACRONYMS: ReadonlySet<string> = new Set([
  "ai",
  "glm",
  "gpt",
  "llm",
  "moe",
  "oss",
]);

/** A trailing snapshot segment (`…-20250929`) as an ISO date, else null. */
function isoDate(segment: string): string | null {
  const parts = /^(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.exec(segment);
  return parts ? `${parts[1]}-${parts[2]}-${parts[3]}` : null;
}

/**
 * Consecutive all-digit segments are ONE version number: model ids spell `4.5`
 * as `4-5`, so splitting on dashes alone would read the version as two words.
 */
function joinVersionRuns(segments: readonly string[]): string[] {
  const out: string[] = [];
  for (const segment of segments) {
    const previous = out[out.length - 1];
    if (
      /^\d+$/.test(segment) &&
      previous !== undefined &&
      /^\d+(\.\d+)*$/.test(previous)
    ) {
      out[out.length - 1] = `${previous}.${segment}`;
      continue;
    }
    out.push(segment);
  }
  return out;
}

function titleCase(word: string): string {
  // Anything starting with a digit is a version or a size ("20b" → "20B").
  if (/^\d/.test(word)) return word.toUpperCase();
  if (ACRONYMS.has(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A readable name derived from a model id, for every id no one curated:
 * `claude-sonnet-4-5-20250929` → "Claude Sonnet 4.5 (2025-09-29)".
 *
 * A gateway's vendor prefix (`anthropic/claude-sonnet-4.6`) is dropped — the
 * name that follows already carries the family, and the row sits under the
 * gateway that serves it. `""` for an empty id: each caller owns its own
 * last-resort copy, which is translated and cannot live in this module.
 */
export function humanizedModelName(id: string): string {
  if (!id) return "";
  const segments = id
    .slice(id.lastIndexOf("/") + 1)
    .split(/[-_]/)
    .filter(Boolean);
  const last = segments[segments.length - 1];
  const date = last === undefined ? null : isoDate(last);
  const name = joinVersionRuns(date ? segments.slice(0, -1) : segments)
    .map(titleCase)
    .join(" ");
  if (!name) return id;
  return date ? `${name} (${date})` : name;
}
