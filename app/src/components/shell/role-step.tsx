import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type AgentRoleId, isAgentRoleId } from "../../lib/agent-role-catalog";
import {
  isLeadershipRoleId,
  type LeadershipRoleId,
} from "../../lib/leadership-roles";
import { ChoiceStep } from "./choice-step";
import type { RoleQuestionAnswer } from "./role-question";
import {
  ROLE_SEARCH_REACH,
  roleRunsForQuery,
  SELF_ROLE_SEARCH_REACH,
  selfRoleRunsForQuery,
} from "./role-step-model";
import type { AgentRoleState } from "./use-agent-role-state";

/** The person's own leadership position, which only the question about them
 *  offers: an AI Employee is hired for a job, never for a position. */
export interface LeadershipChoice {
  selectedId: LeadershipRoleId | null;
  onSelect: (id: LeadershipRoleId) => void;
}

type Audience =
  | { audience?: "agent"; leadership?: never }
  | { audience: "self"; leadership: LeadershipChoice };

/**
 * Step 2 of the guided setup: the job the agent takes over. The picked
 * context's own jobs lead, because they are the ones that made the user answer
 * the first question; the roles every industry shares follow under their
 * own heading. A context the user typed themselves has only the shared run.
 *
 * Searching reaches the whole catalog, so a job the user can name is found
 * wherever it was filed (`role-step-model.ts`).
 *
 * Onboarding asks the person their own role with the same catalog
 * (`audience: "self"`), headed by the leadership positions, which reach the
 * caller through `leadership` rather than `onAnswered`.
 */
export function RoleStep({
  state,
  audience = "agent",
  leadership,
  onAnswered,
}: Audience & {
  state: AgentRoleState;
  /** The answer as given, since `state` only shows it on the next render. */
  onAnswered: (answer: RoleQuestionAnswer<AgentRoleId>) => void;
}) {
  const { t } = useTranslation("agentOnboarding");
  const asksSelf = leadership !== undefined;
  const runsForQuery = useCallback(
    (query: string) => {
      const labels = {
        role: (id: AgentRoleId) => t(`roleSetup.roles.${id}`),
        more: t("roleSetup.moreRoles"),
        other: t("roleSetup.otherRoles"),
      };
      if (!asksSelf) return roleRunsForQuery(state.contextId, query, labels);
      return selfRoleRunsForQuery(state.contextId, query, {
        ...labels,
        leadershipRole: (id) => t(`roleSetup.leadershipRoles.${id}`),
        leadership: t("roleSetup.leadership"),
        context: state.contextId
          ? t(`roleSetup.contexts.${state.contextId}`)
          : "",
      });
    },
    [asksSelf, state.contextId, t],
  );
  const sections = useMemo(() => runsForQuery(""), [runsForQuery]);
  const heldPosition = state.roleIsCustom
    ? null
    : (leadership?.selectedId ?? null);

  return (
    <ChoiceStep
      headline={t(
        audience === "self"
          ? "roleSetup.selfRoleHeadline"
          : "roleSetup.roleHeadline",
      )}
      // An industry the user typed has no jobs of its own, so the ten shared ones
      // are the whole run: say out loud that the filter reaches the rest,
      // or a short run reads as the entire offer.
      hint={
        state.contextId === null ? t("roleSetup.typeToFindAnyRole") : undefined
      }
      keyboardHint={t("roleSetup.chipsKeyboardHint")}
      sections={sections}
      selectedId={state.roleId ?? heldPosition}
      custom={{ active: state.roleIsCustom, value: state.customRole }}
      customLabel={t("roleSetup.somethingElse")}
      customPlaceholder={t("roleSetup.rolePlaceholder")}
      continueLabel={t("roleSetup.continue")}
      cancelLabel={t("roleSetup.cancel")}
      search={{
        placeholder: t("roleSetup.roleSearch"),
        reach: asksSelf ? SELF_ROLE_SEARCH_REACH : ROLE_SEARCH_REACH,
        runsFor: runsForQuery,
        noMatchesLabel: t("roleSetup.noRoleMatches"),
        queryAnswerLabel: (query) => t("roleSetup.useQueryAsRole", { query }),
        onUseQuery: (query) => {
          // The words already typed into the filter ARE the answer: taking
          // them into the custom field saves typing them a second time.
          state.chooseCustomRole();
          state.writeCustomRole(query);
        },
      }}
      onSelect={(id) => {
        if (leadership && isLeadershipRoleId(id)) {
          // A position is the answer instead of a job, never beside one.
          state.clearRole();
          leadership.onSelect(id);
          return;
        }
        // The runs render catalog ids alone, so this only ever narrows.
        if (!isAgentRoleId(id)) return;
        state.chooseRole(id);
        onAnswered({ kind: "catalog", id });
      }}
      onSelectCustom={state.chooseCustomRole}
      onCancelCustom={state.cancelCustomRole}
      onCustomChange={state.writeCustomRole}
      onContinue={() => onAnswered({ kind: "custom", label: state.customRole })}
    />
  );
}
