/**
 * What one of a hire's two questions (the industry, the role) was answered
 * with: a catalog pick, or the person's own words.
 */
export type RoleQuestionAnswer<Id extends string> =
  | { kind: "catalog"; id: Id }
  | { kind: "custom"; label: string };

/**
 * Who the two questions ask about: the AI Employee being hired, or the person
 * using the app, whom onboarding asks the same questions with the same card.
 */
export type RoleQuestionAudience = "agent" | "self";
