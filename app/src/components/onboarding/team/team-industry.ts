// `.ts` extensions so the node test runner can load this module on its own.
import { AGENT_ROLE_PART_MAX_LENGTH } from "../../../lib/agent-role-context.ts";
import {
  NO_SURVEY_ROLE,
  type SurveyIndustryContext,
  type SurveyRoleContext,
} from "../../../lib/onboarding-industry-context.ts";
import type { AgentRoleStart } from "../../shell/use-agent-role-state.ts";

/** A separator left dangling at the end of a cut reads as a typo. */
const TRAILING_SEPARATORS = /[\s,;:/&-]+$/u;

/**
 * An answer in the person's own words (an industry, a role), cut to what the
 * hire flow holds (`AGENT_ROLE_PART_MAX_LENGTH`). The survey keeps up to 200
 * characters, and a hard cut mid-word ("Wholesale distribution of constru")
 * would be the first thing they read about their own business, so the cut
 * lands on the last whole word that fits. A single word longer than the cap is the one case cut
 * inside itself, since dropping it would leave nothing.
 *
 * Counted in code points, like every other cap on these answers, so no cut
 * leaves half an emoji.
 */
export function capAnswerLabel(
  label: string,
  max: number = AGENT_ROLE_PART_MAX_LENGTH,
): string {
  const clean = label
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const points = [...clean];
  if (points.length <= max) return clean;
  // One code point past the cap, so a cut that lands exactly on a space keeps
  // the whole word before it.
  const head = points.slice(0, max + 1).join("");
  const lastSpace = head.lastIndexOf(" ");
  const cut =
    lastSpace > 0 ? head.slice(0, lastSpace) : points.slice(0, max).join("");
  return cut.replace(TRAILING_SEPARATORS, "");
}

/** Where a hire's two questions open, from the person's survey answers. */
export function surveyRoleStart(
  industry: SurveyIndustryContext,
  role: SurveyRoleContext = NO_SURVEY_ROLE,
): AgentRoleStart {
  const words = (label: string | null) => (label ? capAnswerLabel(label) : "");
  return {
    contextId: industry.contextId,
    customContext:
      industry.contextId === null ? words(industry.customLabel) : "",
    roleId: role.roleId,
    customRole: role.roleId === null ? words(role.customLabel) : "",
  };
}
