// `.ts` extensions so the node test runner can import this module directly.
import type { SupportedLocale } from "../locale.ts";
import type { OnboardingCompanySize } from "../onboarding-company-size.ts";
import type { ManagerReach } from "./script-types.ts";

/** One AI Employee as the manager is told about it. */
export interface HandoffEmployee {
  name: string;
  /** The job its description names, when it has one. */
  role?: string;
}

/** What the person told the survey about themselves; null where they did
 *  not say. */
export interface HandoffAbout {
  /** Their role as they read it: a position or job label, or their words. */
  role: string | null;
  companySize: OnboardingCompanySize | null;
}

export interface HandoffInput {
  /** The automation goal, in the person's own words. */
  goal: string;
  about: HandoffAbout;
  team: readonly HandoffEmployee[];
  /** The app's language, which the manager replies in. */
  locale: SupportedLocale;
  reach: ManagerReach;
}

const LANGUAGE: Record<SupportedLocale, string> = {
  en: "English",
  es: "Latin American Spanish, addressing the person as tú",
  pt: "Brazilian Portuguese, addressing the person as você",
};

const COMPANY_SIZE: Record<OnboardingCompanySize, string> = {
  solo: "just them, they work on their own",
  "2_10": "2 to 10 people",
  "11_50": "11 to 50 people",
  "51_200": "51 to 200 people",
  "201_1000": "201 to 1,000 people",
  "1000_plus": "more than 1,000 people",
};

/** The person as the survey knows them, or null when it knows nothing. */
function aboutSection({ role, companySize }: HandoffAbout): string | null {
  const facts = [
    ...(role === null ? [] : [`- Role: ${role}`]),
    ...(companySize === null
      ? []
      : [`- Company size: ${COMPANY_SIZE[companySize]}`]),
  ];
  return facts.length > 0 ? `About them:\n${facts.join("\n")}` : null;
}

function rosterLine({ name, role }: HandoffEmployee): string {
  return role ? `- ${name} (${role})` : `- ${name}`;
}

/**
 * The instruction behind "Yes, let's do it": the first real turn of the AI
 * Manager's conversation, sent right after the onboarding transcript it
 * reads as history. The person's bubble shows only their answer; this is
 * what the manager reads under it.
 *
 * It asks only for what every first run can do (a mission, a hire) plus a
 * tool connection where the deployment serves one, so the manager is never
 * sent after something this Houston cannot do.
 */
export function handoffPrompt({
  goal,
  about,
  team,
  locale,
  reach,
}: HandoffInput): string {
  const roster =
    team.length > 0
      ? team.map(rosterLine).join("\n")
      : "- None yet: they have not hired anyone.";
  const essential = reach.connect
    ? " (for example, a tool that has to be connected for the work)"
    : "";
  const person = aboutSection(about);
  return [
    `[Written by Houston, not typed by the person: they just finished onboarding with you, and said yes when you offered to get their automation goal started.]`,
    `Their goal, in their own words: "${goal}"`,
    ...(person === null ? [] : [person]),
    `Their AI Employees:\n${roster}`,
    [
      "Get the goal started now:",
      "1. Pick the AI Employee best suited to it and start the work as a mission on that AI Employee's board, with a complete brief built from the goal.",
      "2. If none of them fits, hire a new AI Employee for it (a clear name and a one-line role; Houston asks the person to approve the hire), then start the mission on the new AI Employee's board.",
      "3. Tell the person, in plain, non-technical language, what you did: who is working on it and where they can follow the work.",
    ].join("\n"),
    `Ask the person something only when it is essential and you cannot go on without it${essential}. Otherwise, act without asking.`,
    `Reply in ${LANGUAGE[locale]}.`,
  ].join("\n\n");
}
