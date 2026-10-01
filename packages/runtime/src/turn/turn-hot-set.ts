import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HydrateListedObject } from "@houston/runtime-client/object-sync";
import { CLAUDE_FLAGS_DIR, claudeFlagsFileName } from "./claude-flags-path";

function runtimeIndex(segments: string[]): number {
  if (segments[0] === "data") return 1;
  if (
    segments[0] === "workspaces" &&
    segments[3] === ".houston" &&
    segments[4] === "runtime"
  )
    return 5;
  return -1;
}

/** A runtime `claude-flags/` object is admitted only as the member's own file. */
function ownFlagsFile(
  segments: string[],
  runtimeAt: number,
  ownFlags: string | null,
): boolean {
  return (
    segments.length === runtimeAt + 2 && segments[runtimeAt + 1] === ownFlags
  );
}

/**
 * Every object except other members' Claude flag caches: the whole-tree
 * hydrate an unclaimed turn does still never lands another member's cache.
 */
export function ownClaudeFlagsOnly(
  actingUserId?: string,
): (rel: string) => boolean {
  const ownFlags = actingUserId ? claudeFlagsFileName(actingUserId) : null;
  return (rel) => {
    const segments = rel.split("/");
    const runtimeAt = runtimeIndex(segments);
    return (
      runtimeAt === -1 ||
      segments[runtimeAt] !== CLAUDE_FLAGS_DIR ||
      ownFlagsFile(segments, runtimeAt, ownFlags)
    );
  };
}

function mappedClaudeTranscript(
  hydratedRoot: string,
  sessionsRel: string,
  conversationId: string,
  listing: readonly HydrateListedObject[],
): string | null {
  const pointerRel = `${sessionsRel}/claude/sessions.json`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(join(hydratedRoot, ...pointerRel.split("/")), "utf8"),
    );
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  // SAFETY: JSON.parse returned a non-null, non-array object; values remain
  // unknown until the conversation's entry is refined below.
  const sessionId = (parsed as Record<string, unknown>)[conversationId];
  if (typeof sessionId !== "string" || !sessionId) return null;
  const file = `${sessionId}.jsonl`;
  const prefix = `${sessionsRel}/claude/projects/`;
  return listing.some(
    ({ rel }) => rel.startsWith(prefix) && rel.endsWith(`/${file}`),
  )
    ? file
    : null;
}

/**
 * Hot-set admission for one conversation: its canonical conversation,
 * harness markers, the two newest Pi tails, the Claude transcript named by
 * sessions.json, and the acting member's Claude flag cache. Other
 * conversations, older session files, and other members' caches stay remote.
 * Matches both layouts: `workspaces/<ws>/<agent>/.houston/runtime/…` and
 * the per-turn `data/…`.
 *
 * Claimed stores provide manifests. The only list-only claimed fallback is
 * poolOnlyFallbackStore, whose list call fails before this filter can run.
 */
export function ownConversationOnly(
  conversationId: string,
  actingUserId?: string,
): (
  rel: string,
  listing: readonly HydrateListedObject[],
  hydratedRoot: string,
) => boolean {
  const file = `${encodeURIComponent(conversationId)}.json`;
  const ownFlags = actingUserId ? claudeFlagsFileName(actingUserId) : null;
  let claudeSelection: { file: string | null } | undefined;
  return (rel, listing, hydratedRoot) => {
    const segments = rel.split("/");
    const runtimeAt = runtimeIndex(segments);
    if (runtimeAt === -1) return true;
    const kind = segments[runtimeAt];
    const own = segments[runtimeAt + 1];
    // Another member's flag cache is theirs alone: never on this turn's disk.
    if (kind === CLAUDE_FLAGS_DIR)
      return ownFlagsFile(segments, runtimeAt, ownFlags);
    if (kind === "conversations" && segments.length === runtimeAt + 2) {
      return own === file;
    }
    if (kind === "sessions" && segments.length > runtimeAt + 1) {
      if (own !== conversationId) return false;
      const sessionAt = runtimeAt + 2;
      const sessionRel = segments.slice(0, sessionAt).join("/");
      const tail = segments.slice(sessionAt);
      // Houston's own per-conversation markers: the harness that last ran it
      // and a failed autocompact's cooldown (turn-autocompact.ts).
      if (
        tail.length === 1 &&
        (tail[0] === "harness.json" || tail[0] === "autocompact.json")
      )
        return true;
      if (tail.length === 1 && tail[0]?.endsWith(".jsonl")) {
        const sessions = listing
          .map(({ rel: candidate }) => candidate)
          .filter((candidate) => {
            const candidateSegments = candidate.split("/");
            return (
              candidateSegments.length === sessionAt + 1 &&
              candidate.startsWith(`${sessionRel}/`) &&
              candidate.endsWith(".jsonl")
            );
          });
        return sessions.toSorted().slice(-2).includes(rel);
      }
      const claudeRel = tail.join("/");
      if (claudeRel === "claude/sessions.json") return true;
      if (claudeRel.startsWith("claude/projects/")) {
        if (!rel.endsWith(".jsonl")) return false;
        claudeSelection ??= {
          file: mappedClaudeTranscript(
            hydratedRoot,
            sessionRel,
            conversationId,
            listing,
          ),
        };
        return (
          claudeSelection.file === null ||
          rel.endsWith(`/${claudeSelection.file}`)
        );
      }
      // Pi's SessionManager writes and discovers only direct `*.jsonl` files;
      // backend.ts enforces the same resume filter, and the two markers above
      // are Houston's only other direct-file writers.
      return false;
    }
    return true;
  };
}
