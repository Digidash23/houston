// `.ts` extensions so the node test runner can import this module directly.
import type { OnboardingSurveyStep } from "../../components/onboarding/survey-steps.ts";

/** The survey's three questions, in the vocabulary its record and analytics use. */
export type SurveyQuestion = OnboardingSurveyStep;

/** A question the team part of the conversation asks: the team's industry
 *  (only when the survey left none), the team itself, and, on a run resumed
 *  with AI Employees already hired, hiring more or calling it done. */
export type TeamQuestion =
  | "teamIndustry"
  | "teamBasic"
  | "teamNext"
  | "teamDone";

/** What an answer receipt answers: connecting the AI, a survey question, or a
 *  team question. */
export type ReceiptQuestion = "connectAi" | SurveyQuestion | TeamQuestion;

/** Every message the manager says during onboarding. Each is fixed, authored
 *  copy: nothing in onboarding is generated. `closingTeam` is the one the
 *  chat draws as a card, the team card. */
export type ManagerLineId =
  | "hello"
  | "introManager"
  | "introEmployees"
  | "introHow"
  | "connectIntro"
  | "surveyIntro"
  | "teamIntro"
  | "teamResume"
  | "closingTeam"
  | "closingAsk"
  | "profileIntro"
  | "profileThanks";

/**
 * What the AI Manager can do on this deployment beyond handing out missions
 * and hiring (which every deployment that runs first run serves), as its
 * capabilities describe it, so the closing never promises the rest where it
 * is not served.
 */
export interface ManagerReach {
  /** Bring teammates in: served where the deployment has shared spaces. */
  invite: boolean;
  /** Connect the tools an AI Employee works in. */
  connect: boolean;
}

/**
 * One line of the scripted conversation, as data: the view resolves the copy.
 * `key` is stable for the line's meaning, so a line already on screen is never
 * revealed a second time.
 */
export type ScriptLine =
  | {
      kind: "manager";
      key: string;
      id: ManagerLineId;
      /** The person a `hello` greets (absent when their name is unknown). */
      name?: string;
      /** How many AI Employees a `teamResume` line counts. */
      count?: number;
      /** What a `closingTeam` card says the manager can do; absent where no
       *  manager is served. */
      reach?: ManagerReach;
    }
  | {
      kind: "receipt";
      key: string;
      question: ReceiptQuestion;
      /** The answer as stored: a catalog id, a provider id, or the words. */
      value: string;
      /** The latest answer, which the person may still change. */
      editable: boolean;
    };

/** One of the person's answers in the conversation. */
export type ScriptReceipt = Extract<ScriptLine, { kind: "receipt" }>;

/** What the manager is waiting on below the conversation. */
export type ScriptPrompt =
  | { kind: "wait" }
  | { kind: "connectAi" }
  | { kind: "survey"; question: SurveyQuestion }
  | { kind: "team" }
  | { kind: "finish" }
  /** Nothing left to answer: onboarding ends once all is said, and the real
   *  chat takes over where a manager is served. */
  | { kind: "openChat" };

export interface Script {
  lines: ScriptLine[];
  prompt: ScriptPrompt;
}
