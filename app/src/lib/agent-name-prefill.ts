// `.ts` extensions so the node test runner can load this module on its own.
import {
  AGENT_NAME_MAX_LENGTH,
  validateAgentName,
} from "@houston/sdk/agent-name";
import { truncateCodePoints, uniqueAgentName } from "./agent-name.ts";

/**
 * The name a new AI Employee arrives with before anyone types one: its job,
 * as the person reads it ("Chief of Staff"), so a hire is one press away.
 * A job longer than a name may be is cut to fit, and one another AI Employee
 * already goes by is numbered the way every other clash is ("Chief of Staff
 * 2", {@link uniqueAgentName}). A job the host would refuse as a name (a
 * slash, a leading dot) arrives as no name at all, for the person to give.
 */
export function prefilledAgentName(
  role: string,
  taken: readonly string[],
): string {
  const base = truncateCodePoints(role.trim(), AGENT_NAME_MAX_LENGTH).trimEnd();
  if (!validateAgentName(base).ok) return "";
  return uniqueAgentName(base, taken);
}
