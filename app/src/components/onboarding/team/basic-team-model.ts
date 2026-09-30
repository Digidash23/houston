// `.ts` extensions so the node test runner can load this module on its own.

import {
  type AgentContextId,
  type AgentRoleId,
  rolesForContext,
} from "../../../lib/agent-role-catalog.ts";
import type { AgentRoleContext } from "../../../lib/agent-role-context.ts";
import { isLeadershipRoleId } from "../../../lib/leadership-roles.ts";
import {
  briefWithAnswer,
  type JobBriefField,
} from "../../context/job-brief-model.ts";
import { firstNameIssueIndex } from "../../employee-card/employee-name-validation.ts";
import { basicTeamNameIssues } from "./basic-team-names.ts";
import type { RosterMember } from "./team-roster-model.ts";

/**
 * Shared jobs used when the person's industry has fewer than two catalog jobs.
 */
export const BASIC_TEAM_ROLES = [
  "executive_assistant",
  "operations_manager",
  "finance_manager",
] as const satisfies readonly AgentRoleId[];

export function basicTeamRoleIds(
  contextId: AgentContextId | null,
): AgentRoleId[] {
  const selected: AgentRoleId[] = ["executive_assistant"];
  const add = (id: AgentRoleId) => {
    if (
      !isLeadershipRoleId(id) &&
      !selected.includes(id) &&
      selected.length < 3
    )
      selected.push(id);
  };
  for (const id of rolesForContext(contextId).own) add(id);
  for (const id of BASIC_TEAM_ROLES.slice(1)) add(id);
  return selected;
}

export interface BasicTeamDraft {
  /** The card's identity in the team: kept when the person gives it another
   *  job, and never reused by a card added later. */
  key: string;
  /** The job this card began as: a starter's, or the next shared job "Hire
   *  one more" dealt. */
  roleId: AgentRoleId;
  /** The job as the person reads it; also the brief's role. */
  roleLabel: string;
  /** The industry the person gave this card alone, or null for the team's. */
  industry: string | null;
  /** What the person typed, or null while the name follows the job
   *  (`basicTeamNames`). Required to hire. */
  name: string | null;
  /** The color the person picked, or null for the next free one. */
  color: string | null;
  /** Set once this member joined the roster; from then on the roster holds
   *  its name, color and status, and the draft is settled. */
  rosterKey: string | null;
}

export function draftFor(
  roleId: AgentRoleId,
  roleLabel: string,
): BasicTeamDraft {
  return {
    key: roleId,
    roleId,
    roleLabel,
    industry: null,
    name: null,
    color: null,
    rosterKey: null,
  };
}

export function basicTeamDefaults(
  roleLabel: (id: AgentRoleId) => string,
  contextId: AgentContextId | null = null,
): BasicTeamDraft[] {
  return basicTeamRoleIds(contextId).map((roleId) =>
    draftFor(roleId, roleLabel(roleId)),
  );
}

/** The brief a draft is hired with: its job, in its own industry or the
 *  team's. */
export function basicTeamBrief(
  draft: BasicTeamDraft,
  teamIndustry: string,
): AgentRoleContext {
  return { context: draft.industry ?? teamIndustry, role: draft.roleLabel };
}

/**
 * The team with one draft's job or industry answered again on its card: that
 * draft alone changes, and a blank answer changes nothing. A new industry is
 * that card's alone, and it keeps the job: any job pairs with any industry.
 */
export function basicTeamAnswered(
  drafts: readonly BasicTeamDraft[],
  index: number,
  teamIndustry: string,
  field: JobBriefField,
  answer: string,
): BasicTeamDraft[] {
  return drafts.map((draft, at) => {
    if (at !== index) return draft;
    const next = briefWithAnswer(
      basicTeamBrief(draft, teamIndustry),
      field,
      answer,
    );
    if (!next) return draft;
    return field === "industry"
      ? { ...draft, industry: next.context }
      : { ...draft, roleLabel: next.role };
  });
}

/**
 * The color each draft wears: the one the person picked, else its default.
 * Defaults are dealt by place and pinned when a card is added or recolored.
 */
export function basicTeamColors(
  drafts: readonly BasicTeamDraft[],
  nextColor: (dealt: readonly string[]) => string,
): string[] {
  const dealt: string[] = [];
  return drafts.map((draft) => {
    const fallback = nextColor(dealt);
    dealt.push(fallback);
    return draft.color ?? fallback;
  });
}

/**
 * "Hire my team" is offered while there is something left to do: a draft not
 * yet hired, or a member whose create or save failed and is worth another
 * try.
 */
export function hasBasicTeamWork(
  drafts: readonly BasicTeamDraft[],
  failedCount: number,
): boolean {
  return drafts.some((draft) => draft.rosterKey === null) || failedCount > 0;
}

/** What a press of "Hire my team" does. */
export type BasicTeamSubmit =
  | { kind: "idle" }
  /** A name holds the team back: the card at `index` is the first to fix. */
  | { kind: "invalid"; index: number }
  | { kind: "hire" };

export function basicTeamSubmit(
  drafts: readonly BasicTeamDraft[],
  takenNames: readonly string[],
  failedCount: number,
): BasicTeamSubmit {
  if (!hasBasicTeamWork(drafts, failedCount)) return { kind: "idle" };
  const index = firstNameIssueIndex(basicTeamNameIssues(drafts, takenNames));
  return index === null ? { kind: "hire" } : { kind: "invalid", index };
}

/**
 * Hires made one by one on this card whose create or save failed. The basic
 * team's own badges carry their starters' failures; these sit on the roster,
 * off this screen, yet still hold the team back from finishing, so the
 * screen names them on their cards.
 */
export function basicTeamOffscreenFailures(
  drafts: readonly BasicTeamDraft[],
  members: readonly RosterMember[],
): RosterMember[] {
  const starters = new Set(drafts.map((draft) => draft.rosterKey));
  return members.filter(
    (member) =>
      (member.status.kind === "failed" || member.saveFailed) &&
      !starters.has(member.key),
  );
}
