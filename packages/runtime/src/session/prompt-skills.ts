import { realpathSync } from "node:fs";
import { sep } from "node:path";
import type { LoadSkillsResult, Skill } from "@earendil-works/pi-coding-agent";

const byCodeUnit = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Skills in the order the model reads them: by name, then SKILL.md path. The
 * loaders return directory-read order, which differs between filesystems
 * (hashed on ext4 and APFS, creation order on tmpfs) and so between workers,
 * while the skills index sits in the system prompt, where any reorder breaks
 * the cached prefix. Code-unit comparison, never localeCompare: collation
 * follows the process locale, which workers do not share either.
 */
export function sortSkillsForPrompt<T extends Pick<Skill, "name" | "filePath">>(
  skills: readonly T[],
): T[] {
  return [...skills].sort(
    (a, b) => byCodeUnit(a.name, b.name) || byCodeUnit(a.filePath, b.filePath),
  );
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}

/**
 * pi's `skillsOverride` for one agent: its own skills, plus a workspace-shared
 * skill only when the agent's manifest enables it and no local skill has its
 * name, in prompt order. `sharedSkillsDir` must already be a realpath (each
 * skill's dir is resolved before the comparison), and `enabledSharedSkills` is
 * read once, when the loader is built, not on every reload.
 */
export function agentSkillsOverride(
  sharedSkillsDir: string | null,
  enabledSharedSkills: ReadonlySet<string>,
): (base: LoadSkillsResult) => LoadSkillsResult {
  return ({ skills, diagnostics }) => {
    if (!sharedSkillsDir)
      return { skills: sortSkillsForPrompt(skills), diagnostics };
    const isShared = (baseDir: string) =>
      isWithin(realpathSync(baseDir), sharedSkillsDir);
    const localNames = new Set(
      skills
        .filter((skill) => !isShared(skill.baseDir))
        .map((skill) => skill.name),
    );
    return {
      skills: sortSkillsForPrompt(
        skills.filter(
          (skill) =>
            !isShared(skill.baseDir) ||
            (enabledSharedSkills.has(skill.name) &&
              !localNames.has(skill.name)),
        ),
      ),
      diagnostics,
    };
  };
}
