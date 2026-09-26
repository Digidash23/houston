// `.ts` extensions so the node test runner can import this module directly.
import type { OnboardingSurveyPreference } from "../onboarding-survey-record.ts";
import type { ManagerReach, ScriptLine, ScriptPrompt } from "./script-types.ts";

/**
 * The closing of a first run, once the team is built: the team is ready, the
 * AI Employees wait to be opened, and what the manager does from here, one
 * message at a time. Then the person's own automation goal, offered to start
 * now; or, when they skipped it, an invitation to name a task, which the real
 * chat takes over to answer. Where no manager is served (`reach` null) there
 * is nobody to act on either: the closing says the team is ready and ends.
 */
export function closingPart(
  lines: ScriptLine[],
  survey: OnboardingSurveyPreference | null,
  reach: ManagerReach | null,
): ScriptPrompt {
  lines.push(
    { kind: "manager", key: "closingReady", id: "closingReady" },
    { kind: "manager", key: "closingEmployees", id: "closingEmployees" },
  );
  if (reach === null) return { kind: "openChat" };
  // Someone who works alone has nobody to invite, whatever the deployment
  // serves.
  const told: ManagerReach = {
    ...reach,
    invite: reach.invite && survey?.companySize !== "solo",
  };
  lines.push({
    kind: "manager",
    key: "closingManager",
    id: "closingManager",
    reach: told,
  });
  const goal = survey?.automationGoal ?? null;
  if (goal === null) {
    lines.push({ kind: "manager", key: "closingAsk", id: "closingAsk" });
    return { kind: "openChat" };
  }
  lines.push({ kind: "manager", key: "closingGoal", id: "closingGoal", goal });
  return { kind: "handoff", goal };
}

/**
 * Which telling of what the manager does fits what the deployment serves:
 * missions and hiring always, then teammates and tools where they reach.
 */
export function closingManagerVariant(
  reach: ManagerReach | undefined,
): "all" | "invite" | "connect" | "core" {
  if (reach?.invite && reach.connect) return "all";
  if (reach?.invite) return "invite";
  if (reach?.connect) return "connect";
  return "core";
}
