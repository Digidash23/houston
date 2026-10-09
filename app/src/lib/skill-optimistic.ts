/**
 * The optimistic shape of a skill write: what the Skills surfaces show the
 * instant a skill is removed, turned off or on for an employee, before the
 * host answers. Three caches carry it: an employee's own copies
 * (`queryKeys.skills`), its manifest of workspace skills it loads
 * (`queryKeys.skillsManifest`), and the workspace store
 * (`queryKeys.sharedSkills`).
 *
 * Every patch is idempotent and tolerates a cache that never loaded, because
 * `optimisticWrite` re-runs it over any refetch that lands mid-write.
 *
 * Pure; only the query keys are imported (`app/tests/skill-optimistic.test.ts`).
 */

import type { SkillsManifest } from "@houston/engine-adapter";
import type { QueryKey } from "@tanstack/react-query";
import type { OptimisticPatch } from "./optimistic-core.ts";
import { queryKeys } from "./query-keys.ts";
import type { SkillSummary } from "./types";

/** An employee's own copies without `slug`. */
export function withoutSkillCopy(
  list: SkillSummary[] | undefined,
  slug: string,
): SkillSummary[] | undefined {
  if (!list?.some((skill) => skill.name === slug)) return list;
  return list.filter((skill) => skill.name !== slug);
}

/** A manifest with `slug` switched on or off (kept sorted and deduped, as the
 *  host stores it). */
export function withManifestEntry(
  manifest: SkillsManifest | undefined,
  slug: string,
  enabled: boolean,
): SkillsManifest | undefined {
  if (!manifest) return manifest;
  if (manifest.enabled.includes(slug) === enabled) return manifest;
  const rest = manifest.enabled.filter((entry) => entry !== slug);
  return {
    ...manifest,
    enabled: enabled ? [...rest, slug].sort() : rest,
  };
}

/** What the store list query caches. */
interface SharedSkillsList {
  items: SkillSummary[];
}

function isSharedSkillsList(data: unknown): data is SharedSkillsList {
  return (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as { items?: unknown }).items)
  );
}

/**
 * The store list without `slug`. The list key is a PREFIX of every store
 * skill's detail key, so this patch also meets those entries: anything that
 * is not the list passes through untouched.
 */
export function withoutSharedSkill<T>(data: T, slug: string): T {
  if (!isSharedSkillsList(data)) return data;
  if (!data.items.some((skill) => skill.name === slug)) return data;
  return {
    ...data,
    items: data.items.filter((skill) => skill.name !== slug),
  };
}

/** Each employee's own copy of `slug` gone. */
export function copiesRemoved(
  agentPaths: readonly string[],
  slug: string,
): OptimisticPatch[] {
  return agentPaths.map((path) => ({
    queryKey: queryKeys.skills(path),
    apply: (list: SkillSummary[] | undefined) => withoutSkillCopy(list, slug),
  }));
}

/** Each employee's manifest entry for `slug` switched on or off. */
export function manifestsSet(
  agentPaths: readonly string[],
  slug: string,
  enabled: boolean,
): OptimisticPatch[] {
  return agentPaths.map((path) => ({
    queryKey: queryKeys.skillsManifest(path),
    apply: (manifest: SkillsManifest | undefined) =>
      withManifestEntry(manifest, slug, enabled),
  }));
}

/** The store's copy of `slug` gone. */
export function sharedRemoved(
  workspaceId: string,
  slug: string,
): OptimisticPatch {
  return {
    queryKey: queryKeys.sharedSkills(workspaceId),
    apply: (data: unknown) => withoutSharedSkill(data, slug),
  };
}

/** What a skill write refreshes once it settles, landed or refused. */
export function skillWriteRefresh(
  agentPaths: readonly string[],
  workspaceId: string | null,
): QueryKey[] {
  return [
    ...(workspaceId === null ? [] : [queryKeys.sharedSkills(workspaceId)]),
    ...agentPaths.flatMap((path) => [
      queryKeys.skillsManifest(path),
      queryKeys.skills(path),
      ["skill-detail", path],
    ]),
  ];
}
