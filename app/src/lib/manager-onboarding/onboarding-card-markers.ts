// `.ts` extensions so the node test runner can import this module directly.
import type { ManagerReach } from "./script-types.ts";

/**
 * The two onboarding moments the AI Manager's chat draws as cards instead of
 * words. Each rides inside the persisted message behind an HTML comment, like
 * the Skill and answers markers, so the card survives a reload while the model
 * reads the plain text after it:
 *
 * - the team card, on the closing message onboarding writes into the chat;
 * - the goal card, as the words of the message that starts the person's
 *   goal, sent for them (the instructions the model reads ride as the
 *   send's hidden context).
 */
const TEAM_PREFIX = "<!--houston:onboarding-team ";
const GOAL_PREFIX = "<!--houston:onboarding-goal ";
const SUFFIX = "-->";

/** What the team card shows beyond the live roster. */
export interface TeamCardPayload {
  /** What the manager can do here; null where no manager is served. */
  reach: ManagerReach | null;
}

/** The person's goal, as the goal card quotes it. */
export interface GoalCardPayload {
  goal: string;
}

/** JSON that can never close the comment it sits in. */
function markerJson(value: unknown): string {
  return JSON.stringify(value).replaceAll(">", "\\u003e");
}

function decode(content: string, prefix: string): unknown {
  if (!content.startsWith(prefix)) return null;
  const end = content.indexOf(SUFFIX, prefix.length);
  if (end < 0) return null;
  try {
    return JSON.parse(content.slice(prefix.length, end));
  } catch {
    // Not one of ours: the message renders as the words it holds.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReach(value: unknown): value is ManagerReach {
  return (
    isRecord(value) &&
    typeof value.invite === "boolean" &&
    typeof value.connect === "boolean"
  );
}

/** The closing message: the team card over the words the model reads. */
export function encodeTeamCard(payload: TeamCardPayload, text: string): string {
  return `${TEAM_PREFIX}${markerJson(payload)}${SUFFIX}\n\n${text}`;
}

export function decodeTeamCard(content: string): TeamCardPayload | null {
  const value = decode(content, TEAM_PREFIX);
  if (!isRecord(value)) return null;
  if (value.reach === null) return { reach: null };
  return isReach(value.reach) ? { reach: value.reach } : null;
}

/** The kickoff's words: the goal card, which the chat draws in place of the
 *  person's bubble. */
export function encodeGoalCard(payload: GoalCardPayload): string {
  return `${GOAL_PREFIX}${markerJson(payload)}${SUFFIX}`;
}

export function decodeGoalCard(content: string): GoalCardPayload | null {
  const value = decode(content, GOAL_PREFIX);
  return isRecord(value) && typeof value.goal === "string"
    ? { goal: value.goal }
    : null;
}
