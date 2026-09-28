import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentRoleId } from "../../../lib/agent-role-catalog";
import { createAgentRoleContext } from "../../../lib/agent-role-context";
import type { JobBriefField } from "../../context/job-brief-model";
import { visibleNameIssue } from "../../employee-card/employee-name-validation";
import { useEmployeeNameIssueCopy } from "../../employee-card/use-employee-name";
import {
  basicTeamAdd,
  basicTeamRemovable,
  basicTeamRemove,
} from "./basic-team-edit";
import {
  type BasicTeamDraft,
  type BasicTeamSubmit,
  basicTeamAnswered,
  basicTeamBrief,
  basicTeamColors,
  basicTeamDefaults,
  basicTeamOffscreenFailures,
  basicTeamSubmit,
  hasBasicTeamWork,
} from "./basic-team-model";
import { basicTeamNameIssues, basicTeamNames } from "./basic-team-names";
import type { RosterMember } from "./team-roster-model";
import type { TeamRoster } from "./use-team-roster";

/** A starter as its card shows it: still a draft, or a member of the roster
 *  with its status. Either one can be renamed, rebriefed and recolored. */
export interface BasicTeamRow {
  /** The card's identity in the team (`BasicTeamDraft.key`). */
  key: string;
  roleId: AgentRoleId;
  roleLabel: string;
  /** The industry the card shows: its own, or the team's. */
  industry: string;
  /** What the name field holds: a draft's name (its job until the person
   *  types one), or the member's name once it joined. */
  name: string;
  color: string;
  /** Null while a draft; the roster's member once it joined, edited from
   *  then on through the roster. */
  joined: RosterMember | null;
  /** The card's message for a draft's name, or null. */
  error: string | null;
  /** A draft the person may let go (another card still stands). */
  removable: boolean;
}

export interface BasicTeam {
  rows: BasicTeamRow[];
  /** A draft is still to hire, a starter's create failed, or a save did. */
  hasWork: boolean;
  /** Hires made one by one whose create or save failed: off this screen,
   *  yet they hold the team back until tried again (or removed). */
  offscreenFailures: RosterMember[];
  /** A draft's name, brief and color; a joined starter is edited on the
   *  roster. */
  rename: (index: number, name: string) => void;
  answer: (index: number, field: JobBriefField, answer: string) => void;
  recolor: (index: number, color: string) => void;
  /** One more draft on top, dealt the next shared job ("Hire one more"). */
  add: () => void;
  /** Lets a draft go before it is hired. */
  remove: (index: number) => void;
  /** Hires every draft and retries every starter whose create failed, or,
   *  when a name holds them back, says which card to fix first. */
  submit: () => BasicTeamSubmit;
}

/**
 * The starter team: three badges the person may rename, rebrief, recolor, add
 * to and let go of in place before hiring, hired together into `industry` (or the one a card was given) through
 * the card's roster, side by side with anyone already hired one by one. Each
 * name arrives as its job (`basicTeamNames`), so the team hires as it stands;
 * a name cleared to blank is flagged once the person presses "Hire my team".
 */
export function useBasicTeam({
  industry,
  roster,
}: {
  /** The industry as the person reads it: every member's brief context. */
  industry: string;
  roster: TeamRoster;
}): BasicTeam {
  const { t } = useTranslation("agentOnboarding");
  const issueCopy = useEmployeeNameIssueCopy();
  const [attempted, setAttempted] = useState(false);
  const roleLabel = (id: AgentRoleId) =>
    t(`agentOnboarding:roleSetup.roles.${id}`);
  const [held, setDrafts] = useState(() => basicTeamDefaults(roleLabel));
  // A starter let go from the roster (its create failed) is a draft again,
  // with the name and color it had.
  const settle = (list: readonly BasicTeamDraft[]) =>
    list.map((draft) =>
      draft.rosterKey !== null &&
      !roster.members.some((member) => member.key === draft.rosterKey)
        ? { ...draft, rosterKey: null }
        : draft,
    );
  const drafts = settle(held);

  const names = basicTeamNames(drafts, roster.takenNames);
  const issues = basicTeamNameIssues(drafts, roster.takenNames);
  const colors = basicTeamColors(drafts, roster.nextColor);
  const rows = drafts.map((draft, index): BasicTeamRow => {
    const member = roster.members.find((m) => m.key === draft.rosterKey);
    const shown = visibleNameIssue(issues[index], attempted);
    return {
      key: draft.key,
      roleId: draft.roleId,
      roleLabel: draft.roleLabel,
      industry: basicTeamBrief(draft, industry).context,
      name: member ? member.name : names[index],
      color: member?.color ?? colors[index],
      joined: member ?? null,
      error: member ? null : issueCopy(shown, names[index]),
      removable: basicTeamRemovable(drafts, index),
    };
  });
  const failed = rows.filter((row) => row.joined?.status.kind === "failed");
  // A save that failed is sent again by the finish this press requests.
  const retries =
    failed.length + roster.members.filter((m) => m.saveFailed).length;

  const update = (index: number, change: Partial<BasicTeamDraft>) =>
    setDrafts((current) =>
      current.map((draft, at) =>
        at === index ? { ...draft, ...change } : draft,
      ),
    );

  const hireAll = () => {
    for (const row of failed) if (row.joined) roster.retry(row.joined.key);
    const keys = rows.map((row) => {
      if (row.joined) return row.joined.key;
      const brief = createAgentRoleContext({
        context: row.industry,
        role: row.roleLabel,
      });
      // Unreachable while the view holds an industry; narrowing, not a skip.
      if (!brief) return null;
      return roster.join({ name: row.name.trim(), color: row.color, brief });
    });
    // The name and color are pinned with the hire, so a starter let go comes
    // back as a draft with the ones it had.
    setDrafts((current) =>
      current.map((draft, at) => ({
        ...draft,
        name: rows[at].name,
        color: rows[at].color,
        rosterKey: keys[at],
      })),
    );
  };

  return {
    rows,
    hasWork: hasBasicTeamWork(drafts, retries),
    offscreenFailures: basicTeamOffscreenFailures(drafts, roster.members),
    rename: (index, name) => update(index, { name }),
    answer: (index, field, answer) =>
      setDrafts((current) =>
        basicTeamAnswered(current, index, industry, field, answer),
      ),
    recolor: (index, color) => update(index, { color }),
    add: () =>
      setDrafts((current) =>
        basicTeamAdd(current, roleLabel, colors, roster.nextColor),
      ),
    remove: (index) =>
      setDrafts((current) => basicTeamRemove(settle(current), index, colors)),
    submit: () => {
      const outcome = basicTeamSubmit(drafts, roster.takenNames, retries);
      if (outcome.kind === "invalid") setAttempted(true);
      if (outcome.kind === "hire") hireAll();
      return outcome;
    },
  };
}
