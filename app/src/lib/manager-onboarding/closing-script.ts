// `.ts` extensions so the node test runner can import this module directly.
import type { OnboardingSurveyPreference } from "../onboarding-survey-record.ts";
import type { ManagerReach, ScriptLine, ScriptPrompt } from "./script-types.ts";

/**
 * The closing of a first run, once the team is built: one team card, the
 * team ready to open and what the manager does from here. A person who gave
 * an automation goal sees it start next, as the goal card of the real chat;
 * one who skipped it is asked for a task, which the real chat takes over to
 * answer. Where no manager is served (`reach` null) there is nobody to act
 * on either: the card promises nothing of the manager and the closing ends.
 */
export function closingPart(
  lines: ScriptLine[],
  survey: OnboardingSurveyPreference | null,
  reach: ManagerReach | null,
): ScriptPrompt {
  if (reach === null) {
    lines.push({ kind: "manager", key: "closingTeam", id: "closingTeam" });
    return { kind: "openChat" };
  }
  lines.push({
    kind: "manager",
    key: "closingTeam",
    id: "closingTeam",
    // Someone who works alone has nobody to invite, whatever the deployment
    // serves.
    reach: { ...reach, invite: reach.invite && survey?.companySize !== "solo" },
  });
  if ((survey?.automationGoal ?? null) === null)
    lines.push({ kind: "manager", key: "closingAsk", id: "closingAsk" });
  return { kind: "openChat" };
}

/**
 * Which telling of what the manager does fits what the deployment serves:
 * missions and hiring always, then teammates and tools where they reach.
 */
export function closingManagerVariant(
  reach: ManagerReach,
): "all" | "invite" | "connect" | "core" {
  if (reach.invite && reach.connect) return "all";
  if (reach.invite) return "invite";
  if (reach.connect) return "connect";
  return "core";
}
