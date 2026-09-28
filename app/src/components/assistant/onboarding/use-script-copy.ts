import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  isAgentContextId,
  isAgentRoleId,
} from "../../../lib/agent-role-catalog";
import { isLeadershipRoleId } from "../../../lib/leadership-roles";
import { closingManagerVariant } from "../../../lib/manager-onboarding/closing-script";
import type {
  ReceiptQuestion,
  ScriptLine,
} from "../../../lib/manager-onboarding/script";
import { SURVEY_SKIPPED } from "../../../lib/manager-onboarding/survey-script";
import { isOnboardingCompanySize } from "../../../lib/onboarding-survey";
import { providerName } from "../../../lib/providers";

type Receipt = Extract<ScriptLine, { kind: "receipt" }>;
type ManagerLine = Extract<ScriptLine, { kind: "manager" }>;

/** One receipt as the answers card shows it: the question it answered (none
 *  for a confirmation, like a connection) above the answer. */
export interface ReceiptCopy {
  question?: string;
  answer: string;
}

/**
 * The words of the scripted conversation: what the manager says, each
 * question as its card asks it, and each answer as the person gave it. The
 * question text is ONE lookup, so a receipt always repeats its card's
 * question word for word.
 */
export function useScriptCopy() {
  const { t } = useTranslation([
    "assistant",
    "setup",
    "agentOnboarding",
    "chat",
  ]);

  const question = useCallback(
    (asked: ReceiptQuestion): string | undefined => {
      switch (asked) {
        case "industry":
          return t("agentOnboarding:roleSetup.selfContextHeadline");
        case "role":
          return t("agentOnboarding:roleSetup.selfRoleHeadline");
        case "companySize":
          return t("assistant:onboarding.questions.companySize");
        case "goal":
          return t("setup:onboardingSurvey.goal.title");
        case "teamIndustry":
          return t("agentOnboarding:roleSetup.contextHeadline");
        case "teamBasic":
          return t("setup:team.basic.title");
        // Answered with a button right under the manager's line: the answer
        // is the whole reply.
        case "connectAi":
        case "teamNext":
        case "teamDone":
          return undefined;
      }
    },
    [t],
  );

  /** A catalog id as its label, "Something else" as such, and anything else
   *  as the words the person typed. */
  const catalogAnswer = useCallback(
    (value: string, label: (value: string) => string | null): string => {
      if (value === "something_else")
        return t("agentOnboarding:roleSetup.somethingElse");
      return label(value) ?? value;
    },
    [t],
  );

  /** An answer as the person reads it, from the question and the value its
   *  receipt carries. */
  const answer = useCallback(
    (question: ReceiptQuestion, value: string): string => {
      if (value === SURVEY_SKIPPED && question !== "teamBasic")
        return t("assistant:onboarding.answers.skipped");
      switch (question) {
        case "connectAi":
          return value
            ? t("chat:interaction.connectedLine", { name: providerName(value) })
            : t("assistant:onboarding.answers.connected");
        case "industry":
        case "teamIndustry":
          return catalogAnswer(value, (id) =>
            isAgentContextId(id)
              ? t(`agentOnboarding:roleSetup.contexts.${id}`)
              : null,
          );
        case "role":
          return catalogAnswer(value, (id) => {
            if (isAgentRoleId(id))
              return t(`agentOnboarding:roleSetup.roles.${id}`);
            return isLeadershipRoleId(id)
              ? t(`agentOnboarding:roleSetup.leadershipRoles.${id}`)
              : null;
          });
        case "companySize":
          return isOnboardingCompanySize(value)
            ? t(`assistant:onboarding.companySize.${value}`)
            : value;
        case "teamNext":
          return t("assistant:onboarding.choices.another");
        case "teamDone":
          return t("assistant:onboarding.choices.done");
        case "goal":
        case "teamBasic":
          return value;
      }
    },
    [t, catalogAnswer],
  );

  const manager = useCallback(
    (line: ManagerLine): string => {
      switch (line.id) {
        case "hello":
          return line.name === undefined
            ? t("assistant:onboarding.say.hello")
            : t("assistant:onboarding.say.helloNamed", { name: line.name });
        case "teamResume":
          return t("assistant:onboarding.say.teamResume", {
            count: line.count ?? 0,
          });
        case "closingManager":
          return t(
            `assistant:onboarding.say.closingManager.${closingManagerVariant(line.reach)}`,
          );
        case "closingGoal":
          return t("assistant:onboarding.say.closingGoal", { goal: line.goal });
        default:
          return t(`assistant:onboarding.say.${line.id}`);
      }
    },
    [t],
  );

  return useMemo(
    () => ({
      question,
      answer,
      receipt: (line: Receipt): ReceiptCopy => ({
        question: question(line.question),
        answer: answer(line.question, line.value),
      }),
      manager,
    }),
    [question, answer, manager],
  );
}

export type ScriptCopy = ReturnType<typeof useScriptCopy>;
