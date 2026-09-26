// `.ts` extensions so the node test runner can import this module directly.
import { isSurveyQuestion } from "../../components/onboarding/survey-steps.ts";
import type {
  Script,
  ScriptLine,
  ScriptPrompt,
  ScriptReceipt,
} from "./script-types.ts";

/** The prompts that end the conversation: nothing is asked again after. */
const ENDING: ReadonlySet<ScriptPrompt["kind"]> = new Set([
  "finish",
  "handoff",
  "openChat",
]);

/**
 * Only the latest answer offers a change, and only a survey answer or a team
 * answer that `teamLines` left open (a hire, the connection and a finished
 * team are for good).
 */
export function finalize(lines: ScriptLine[], prompt: ScriptPrompt): Script {
  const last = lines.findLastIndex((line) => line.kind === "receipt");
  const ended = ENDING.has(prompt.kind);
  return {
    prompt,
    lines: lines.map((line, index) => {
      if (line.kind !== "receipt") return line;
      const open = line.editable || (isSurveyQuestion(line.question) && !ended);
      return { ...line, editable: index === last && open };
    }),
  };
}

/**
 * The answer the person may still take back, or null: the latest one, while
 * it is open to change. "Change answer" under it and the Back of the step
 * after it both reopen it, so going back is one move wherever it is offered.
 */
export function changeableAnswer(
  lines: readonly ScriptLine[],
): ScriptReceipt | null {
  const line = lines.findLast((each) => each.kind === "receipt");
  return line?.kind === "receipt" && line.editable ? line : null;
}
