import type { AgentDelegationRefusalCode } from "@houston/protocol";

export const DELEGATED_ROUTINE_REFUSAL =
  "A mission another AI Employee gave you can't set up routines. Finish the mission, or ask the user to set this up from a chat.";

export function isRoutinePause(body: Record<string, unknown>): boolean {
  return (
    typeof body.id === "string" &&
    body.id.length > 0 &&
    body.enabled === false &&
    Object.keys(body).every((key) => key === "id" || key === "enabled")
  );
}

export function delegationRefusal(
  code: AgentDelegationRefusalCode,
  name = "That AI Employee",
): { status: number; code: AgentDelegationRefusalCode; error: string } {
  const errors: Record<AgentDelegationRefusalCode, string> = {
    delegation_off:
      "You're not set up to work with other AI Employees. If the user wants this, they can turn it on in your settings under Teamwork.",
    agent_not_allowed: `You can only work with the AI Employees the user picked, and ${name} isn't one of them. The user can change this in your settings under Teamwork.`,
    agent_not_accepting: `${name} isn't taking new missions from other AI Employees right now. You can still read its instructions and missions. The user can turn this on in ${name}'s settings under Teamwork, or you can do the work yourself.`,
    not_mission_origin:
      "You can only move missions you started yourself. Tell the user instead so they can move it.",
    no_acting_person:
      "You can only reach other AI Employees while working for someone. Do the work yourself, or ask the user to start it from a chat.",
    caller_not_assigned:
      "You can't work with other AI Employees for this person. Ask the user to check your access.",
    not_assigned: `${name} isn't available to the person you're working for. Ask the user to check access.`,
    agent_scope:
      "This action isn't available while working with another AI Employee.",
    mission_depth:
      "Missions started by an AI Employee can't start further missions. Ask in the original chat instead.",
  };
  return {
    status: code === "mission_depth" ? 409 : 403,
    code,
    error: errors[code],
  };
}
