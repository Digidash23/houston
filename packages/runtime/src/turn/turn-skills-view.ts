import { join } from "node:path";
import { skillsDirKey } from "@houston/domain";
import { dispatchAgentOp } from "@houston/host/src/op/dispatch";
import { PrefixedVfs } from "@houston/host/src/vfs";
import { engineAgentId } from "./op-scope";
import type { TurnServerDeps } from "./server-types";
import type { ActivityDocPublishResult } from "./turn-activity-doc";
import { publishMerged } from "./turn-doc-merge-publish";
import { turnDocTarget } from "./turn-doc-target";
import type { TurnFilesystem } from "./turn-filesystem";
import type { TurnRequest } from "./types";

/** The host's `GET skills` answer: summaries and diagnostics, slug order. */
interface SkillsView {
  items: Array<Record<string, unknown> & { name: string }>;
  diagnostics: Array<Record<string, unknown> & { key: string }>;
}

const DIAGNOSTIC_SLUG = /\/\.agents\/skills\/([^/]+)\/SKILL\.md$/;

const diagnosticSlug = (entry: { key: string }) =>
  DIAGNOSTIC_SLUG.exec(entry.key)?.[1] ?? "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isSkillsView(value: unknown): value is SkillsView {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) => isRecord(item) && typeof item.name === "string",
    ) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.key === "string" &&
        DIAGNOSTIC_SLUG.test(entry.key),
    )
  );
}

/**
 * Slugs whose top-level SKILL.md the turn landed or deleted. Only that file
 * feeds the list (`loadSkillsFromDir`); a skill's other files never change it.
 */
export function landedSkillSlugs(
  workspaceRel: string,
  keys: Iterable<string>,
): Set<string> {
  const dir = `${skillsDirKey(workspaceRel)}/`;
  const slugs = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(dir)) continue;
    const [slug, file, ...deeper] = key.slice(dir.length).split("/");
    if (slug && file === "SKILL.md" && deeper.length === 0) slugs.add(slug);
  }
  return slugs;
}

/** The pod's own `GET skills` over the turn's tree: byte parity by construction. */
async function captureSkillsView(
  filesystem: TurnFilesystem,
): Promise<SkillsView> {
  const answer = await dispatchAgentOp({
    workspacesRoot: join(filesystem.storeRoot, "workspaces"),
    agentId: engineAgentId(filesystem),
    vfs: new PrefixedVfs(filesystem.vfs, "workspaces"),
    request: { method: "GET", rest: "skills", triggersEnabled: false },
  });
  if (answer.status !== 200)
    throw new Error(`skills view not captured (${answer.status})`);
  const view = JSON.parse(answer.body) as unknown;
  if (!isSkillsView(view)) throw new Error("skills view has an unknown shape");
  return view;
}

const bySlug =
  <T>(slugOf: (entry: T) => string) =>
  (a: T, b: T) => {
    const left = slugOf(a);
    const right = slugOf(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };

/** `standing` with this turn's slugs swapped for `captured`'s, slug order. */
function swapSlugs<T>(
  standing: T[],
  captured: T[],
  slugs: ReadonlySet<string>,
  slugOf: (entry: T) => string,
): T[] {
  return [
    ...standing.filter((entry) => !slugs.has(slugOf(entry))),
    ...captured.filter((entry) => slugs.has(slugOf(entry))),
  ].sort(bySlug(slugOf));
}

/**
 * Merge this turn's skills into the stored view, never a blind copy: the
 * turn's tree is a snapshot from its hydration, so its whole list would drop
 * a skill another turn landed since. Only the slugs this turn wrote or
 * deleted move. With no readable doc there is nothing to merge into, and the
 * whole captured list is what an awake pod would publish.
 */
function mergeSkillsView(
  current: unknown,
  captured: SkillsView,
  slugs: ReadonlySet<string>,
): SkillsView {
  if (!isSkillsView(current)) return captured;
  return {
    items: swapSlugs(current.items, captured.items, slugs, (item) => item.name),
    diagnostics: swapSlugs(
      current.diagnostics,
      captured.diagnostics,
      slugs,
      diagnosticSlug,
    ),
  };
}

/**
 * Republish the skills view a claimed turn changed. The gateway serves a
 * sleeping agent's Skills tab from that doc, so without this a skill the
 * agent wrote (or deleted) stays invisible until a pod wakes. Null when the
 * turn landed no SKILL.md or has no doc system to project into.
 */
export async function publishLandedSkillsView(input: {
  deps: TurnServerDeps;
  turn: TurnRequest;
  filesystem: TurnFilesystem;
  landed: readonly string[];
}): Promise<ActivityDocPublishResult | null> {
  const { filesystem } = input;
  const slugs = landedSkillSlugs(filesystem.workspaceRel, input.landed);
  // Only a standing tree is an agent the host's handlers can resolve.
  if (slugs.size === 0 || filesystem.kind !== "standing") return null;
  const target = turnDocTarget(input.deps, input.turn, "skills");
  if (!target) return null;
  try {
    const captured = await captureSkillsView(filesystem);
    return await publishMerged(target, (current) =>
      mergeSkillsView(current, captured, slugs),
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
