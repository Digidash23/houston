import type { OpResult } from "./op-apply";
import type { ActivityDocOptions } from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import type { TurnFilesystem } from "./turn-filesystem";
import { publishLearningsDoc } from "./turn-learnings-doc";
import {
  isSkillsView,
  landedSkillSlugs,
  publishSkillsView,
} from "./turn-skills-doc";
import { viewPublishFailure } from "./turn-view-publish";

/**
 * The docs an op projects from what the STORE holds after its write landed,
 * the same way pooled turns publish them: the skills its landed SKILL.md
 * writes and deletes changed (`landed`), and the learnings when it wrote
 * them. An op's own tree is a snapshot from its listing, so projecting it
 * whole would drop a skill or memory a turn landed since. Answers the
 * diagnostics (empty = every doc landed).
 */
export async function publishOpStoreDocs(input: {
  common: Omit<ActivityDocOptions, "family">;
  source: ActivityDocSource;
  filesystem: TurnFilesystem;
  result: OpResult;
  landed: readonly string[];
  learnings: boolean;
}): Promise<string[]> {
  const { common, source, filesystem } = input;
  const diagnostics: string[] = [];
  const slugs = landedSkillSlugs(filesystem.workspaceRel, input.landed);
  if (slugs.size > 0) {
    const outcome = await publishSkillsView({
      target: { ...common, family: "skills" },
      source,
      filesystem,
      slugs,
      base: async () =>
        isSkillsView(input.result.skillsView)
          ? input.result.skillsView
          : undefined,
    });
    const failure = viewPublishFailure(outcome);
    if (failure) diagnostics.push(`skills: ${failure}`);
  }
  if (input.learnings) {
    const outcome = await publishLearningsDoc(
      { ...common, family: "learnings" },
      source,
      filesystem.workspaceRel,
    );
    if ("error" in outcome) diagnostics.push(`learnings: ${outcome.error}`);
  }
  return diagnostics;
}
