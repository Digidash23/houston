// `.ts` extensions so the node test runner can load this module on its own.
import { prefilledAgentName } from "../../../lib/agent-name-prefill.ts";
import {
  type EmployeeNameIssue,
  employeeNameIssue,
} from "../../employee-card/employee-name-validation.ts";
import type { BasicTeamDraft } from "./basic-team-model.ts";

/**
 * The name each draft's field holds: the one the person typed, or its job
 * (`prefilledAgentName`) while nobody has. A job name steps over the
 * workspace's AI Employees, every name typed on another card and the job
 * names dealt before it, so an untouched team is ready to hire as it stands.
 */
export function basicTeamNames(
  drafts: readonly BasicTeamDraft[],
  takenNames: readonly string[],
): string[] {
  const typed = drafts.flatMap((draft) =>
    draft.rosterKey === null && draft.name !== null && draft.name.trim() !== ""
      ? [draft.name.trim()]
      : [],
  );
  const dealt: string[] = [];
  return drafts.map((draft) => {
    if (draft.name !== null) return draft.name;
    const name = prefilledAgentName(draft.roleLabel, [
      ...takenNames,
      ...typed,
      ...dealt,
    ]);
    dealt.push(name);
    return name;
  });
}

/**
 * What holds each draft back, in order: a blank name (every AI Employee needs
 * one), or a name the host would refuse. Every name is checked against the
 * workspace's AI Employees AND the other drafts still to hire, since three
 * hires sharing a name would refuse the second. A member on the roster is
 * settled and never re-checked (its name is itself one of `takenNames`).
 */
export function basicTeamNameIssues(
  drafts: readonly BasicTeamDraft[],
  takenNames: readonly string[],
): (EmployeeNameIssue | null)[] {
  const names = basicTeamNames(drafts, takenNames);
  return drafts.map((draft, index) => {
    if (draft.rosterKey !== null) return null;
    const siblings = names.filter(
      (name, other) =>
        other !== index &&
        drafts[other].rosterKey === null &&
        name.trim() !== "",
    );
    return employeeNameIssue(names[index], [
      ...takenNames,
      ...siblings.map((name) => name.trim()),
    ]);
  });
}
